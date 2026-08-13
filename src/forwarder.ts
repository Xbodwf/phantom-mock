import axios from 'axios';
import type { ChatCompletionRequest, ForwardVariant, Model } from './types.js';
import { applyModelTarget, selectModelTarget } from './forwarding/targets.js';
import { getProtocolAdapterOrOpenAI, registerProtocolAdapter } from './forwarding/adapters.js';
import type { Response } from 'express';
import { generateRequestId } from './responseBuilder.js';
import { getProviderById, getNodeById, getSettings } from './storage.js';

/**
 * 部分隐藏 key，只显示前4位和后4位
 */
export function hideKey(key: string): string {
  if (!key) return '(none)';
  if (key.length <= 8) return '****';
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

/**
 * 标准化 API 错误响应格式
 * 将不同 API 提供商的错误格式统一为 OpenAI 格式
 */
export function standardizeErrorResponse(error: any, apiType: string = 'unknown'): any {
  // 如果已经是标准格式，直接返回
  if (error.error && error.error.message && error.error.type) {
    return error;
  }

  let message = 'Unknown error';
  let type = 'api_error';
  let code = 'internal_error';

  // 处理 axios 错误
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;

    // 根据 API 类型解析错误
    switch (apiType) {
      case 'openai':
      case 'azure':
      case 'custom':
        // OpenAI 格式错误
        if (data.error) {
          message = data.error.message || 'OpenAI API error';
          type = data.error.type || 'api_error';
          code = data.error.code || 'api_error';
        } else {
          message = data.message || `HTTP ${status}`;
        }
        break;

      case 'anthropic':
        // Anthropic 格式错误
        if (data.error) {
          message = data.error.message || 'Anthropic API error';
          type = data.error.type || 'api_error';
        } else {
          message = data.message || `HTTP ${status}`;
        }
        break;

      case 'google':
        // Google 格式错误
        if (data.error) {
          if (typeof data.error === 'object') {
            message = data.error.message || 'Google API error';
            code = data.error.code || 'api_error';
          } else {
            message = data.error;
          }
        } else {
          message = data.message || `HTTP ${status}`;
        }
        break;

      default:
        message = data.message || data.error?.message || `HTTP ${status}`;
    }
  } else if (error.message) {
    message = error.message;
  }

  return {
    error: {
      message,
      type,
      code,
      api_type: apiType,
    }
  };
}

/**
 * 获取模型的有效 API key（支持 provider 模式）
 */
export function getEffectiveApiKey(model: Model): string {
 let effectiveApiKey = model.api_key || '';
 
 if (model.forwardingMode === 'provider' && model.providerId) {
  const provider = getProviderById(model.providerId);
  if (provider && provider.keys && provider.keys.length > 0) {
   const enabledKeys = provider.keys.filter(k => k.enabled);
   if (enabledKeys.length > 0) {
    const idx = (provider.rrCursor || 0) % enabledKeys.length;
    effectiveApiKey = enabledKeys[idx].key || effectiveApiKey;
   }
  }
 }
 
 return effectiveApiKey;
}

/**
 * 合并默认请求头和运行时请求头
 * 运行时请求头优先级更高
 */
export function mergeHeaders(
  defaultHeaders?: Record<string, string>,
  runtimeHeaders?: Record<string, string>
): Record<string, string> {
  const merged = { ...defaultHeaders };
  if (runtimeHeaders) {
    Object.assign(merged, runtimeHeaders);
  }
  return merged;
}

/**
 * 检查模型是否应该通过节点转发
 */
export function shouldUseNodeForwarding(model: Model): boolean {
 return model.forwardingMode === 'node' && !!model.nodeId;
}

/**
 * 获取转发时使用的模型名称
 */
export function getForwardModelName(model: Model, requestedModel: string): string {
  return model.forwardModelName || requestedModel;
}

export function isModelForwardingConfigured(model: Model): boolean {
 // 如果是节点转发模式，检查节点是否在线
 if (model.forwardingMode === 'node' && model.nodeId) {
  const node = getNodeById(model.nodeId);
  return node?.status === 'online';
 }

 // 如果是 provider 转发模式，检查 provider 是否配置
 if (model.forwardingMode === 'provider' && model.providerId) {
  const provider = getProviderById(model.providerId);
  if (provider && provider.keys && provider.keys.some(k => k.enabled)) {
   return true;
  }
 }

 // 检查是否有 api_key 和 api_base_url（非 provider/node 模式的直接转发配置）
 return !!model.api_key && !!model.api_base_url;
}

async function getForwarderTimeoutMs(): Promise<number> {
  const settings = await getSettings();
  return (settings.forwarderTimeout ?? 1000) * 1000;
}

type ForwardEndpoint =
  | 'chat'
  | 'responses'
  | 'embeddings'
  | 'rerank'
  | 'anthropicMessages'
  | 'geminiGenerateContent'
  | 'geminiStreamGenerateContent'
  | 'geminiEmbedContent'
  | 'imageGenerations'
  | 'imageEdits';

function registerForwardingAdapters(): void {
  const openaiAdapter = {
    protocol: 'openai' as const,
    variants: ['chat-completions', 'responses', 'embeddings', 'image-generations', 'image-edits'] as const,
    forwardChat: (model: Model, body: ChatCompletionRequest, variant?: ForwardVariant) => forwardToOpenAI(model, body, variant),
  };
  registerProtocolAdapter(openaiAdapter);
  registerProtocolAdapter({ ...openaiAdapter, protocol: 'azure' });
  registerProtocolAdapter({ ...openaiAdapter, protocol: 'custom' });
  registerProtocolAdapter({
    protocol: 'anthropic',
    variants: ['messages'] as const,
    forwardChat: (model, body) => forwardToAnthropic(model, body),
  });
  registerProtocolAdapter({
    protocol: 'google',
    variants: ['generate-content', 'stream-generate-content'] as const,
    forwardChat: (model, body) => forwardToGoogle(model, body),
  });
}

registerForwardingAdapters();

function normalizeBaseUrl(baseUrl: string): string {
 return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function appendPath(baseUrl: string, path: string): string {
 const normalizedBase = normalizeBaseUrl(baseUrl);
 const normalizedPath = path.startsWith('/') ? path : `/${path}`;
 return `${normalizedBase}${normalizedPath}`;
}

function toOpenAIResponsesBody(body: ChatCompletionRequest, model: string): any {
  const systemMessages = body.messages.filter(message => message.role === 'system');
  const inputMessages = body.messages.filter(message => message.role !== 'system');
  return {
    model,
    ...(systemMessages.length > 0 ? {
      instructions: systemMessages
        .map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
        .join('\n'),
    } : {}),
    input: inputMessages,
    stream: body.stream === true,
    ...(body.max_tokens !== undefined ? { max_output_tokens: body.max_tokens } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.tools ? { tools: body.tools } : {}),
  };
}

function fromOpenAIResponsesBody(response: any, requestedModel: string): any {
  const output = response?.output || [];
  const message = output.find((item: any) => item.type === 'message');
  const content = message?.content
    ?.filter((item: any) => item.type === 'output_text')
    ?.map((item: any) => item.text || '')
    ?.join('') || '';
  const usage = response?.usage;
  return {
    id: response?.id || generateRequestId(),
    object: 'chat.completion',
    created: response?.created_at || Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: response?.status === 'completed' ? 'stop' : null,
    }],
    usage: {
      prompt_tokens: usage?.input_tokens || 0,
      completion_tokens: usage?.output_tokens || 0,
      total_tokens: usage?.total_tokens || 0,
    },
  };
}

export function resolveForwardUrl(
 model: Model,
 endpoint: ForwardEndpoint,
 requestedModel: string,
 forwardModel: string
): string {
 // 从 model 或 provider 或 node 获取配置
 let effectiveBaseUrl = '';
 let effectiveApiKey = model.api_key || '';

 // 优先级：provider/node 模式 > model 直接配置
 // 如果配置了 provider，从 provider 获取 base URL 和 key
 if (model.forwardingMode === 'provider' && model.providerId) {
 const provider = getProviderById(model.providerId);
 if (provider) {
 effectiveBaseUrl = provider.api_base_url || '';
 // 使用 provider 的 key（轮询选择）
 if (provider.keys && provider.keys.length > 0) {
 const enabledKeys = provider.keys.filter(k => k.enabled);
 if (enabledKeys.length > 0) {
 // 简单轮询
 const idx = (provider.rrCursor || 0) % enabledKeys.length;
 effectiveApiKey = enabledKeys[idx].key || effectiveApiKey;
 }
 }
 }
 }
 
 // 如果配置了 node，从 node 获取信息（节点通过 WebSocket 连接，不需要 base URL）
 if (model.forwardingMode === 'node' && model.nodeId) {
 const node = getNodeById(model.nodeId);
 if (node && node.status === 'online') {
 // 节点模式下，应该通过 WebSocket 转发，不应该到达这里
 throw new Error('Node forwarding should use WebSocket, not HTTP');
 }
 throw new Error(`Node ${model.nodeId} is not online`);
 }

 // 如果 provider/node 模式没有获取到 base URL，使用 model 直接配置的 api_base_url（向后兼容）
 if (!effectiveBaseUrl && model.api_base_url) {
 effectiveBaseUrl = model.api_base_url;
 }

 if (!effectiveApiKey) {
 throw new Error('Model not configured for forwarding: missing api_key');
 }

  // 根据 endpoint 选择路径字段
  const api_url_path = (endpoint === 'imageEdits' || endpoint === 'geminiStreamGenerateContent')
  ? (model.api_url_path_2 || model.api_url_path)
  : model.api_url_path;
  const baseUrl = normalizeBaseUrl(effectiveBaseUrl || '');

   // 如果有 api_url_path，直接拼接
   if (api_url_path && api_url_path.trim()) {
  const trimmedPath = api_url_path.trim();
  const normalizedPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
  return `${baseUrl}${normalizedPath}`;
   }

  if (!baseUrl) {
  throw new Error(`Model not configured for forwarding endpoint: ${endpoint}`);
  }

   switch (endpoint) {
   case 'chat':
  return baseUrl.includes('/chat/completions')
  ? baseUrl
   : appendPath(baseUrl, '/chat/completions');
  case 'embeddings':
  return baseUrl.includes('/embeddings')
  ? baseUrl
  : appendPath(baseUrl, '/embeddings');
  case 'rerank':
  return baseUrl.includes('/rerank')
  ? baseUrl
  : appendPath(baseUrl, '/rerank');
  case 'anthropicMessages':
  // 检查是否已包含/messages或/v1/messages
  if (baseUrl.includes('/messages')) {
  return baseUrl;
  }
  // 如果baseUrl已包含/v1，直接添加/messages，否则添加/v1/messages
  if (baseUrl.includes('/v1')) {
  return appendPath(baseUrl, '/messages');
  } else {
  return appendPath(baseUrl, '/v1/messages');
  }
  case 'geminiGenerateContent':
  return `${baseUrl}/v1beta/models/${encodeURIComponent(forwardModel)}:generateContent?key=${encodeURIComponent(effectiveApiKey)}`;
  case 'geminiStreamGenerateContent':
  return `${baseUrl}/v1beta/models/${encodeURIComponent(forwardModel)}:streamGenerateContent?key=${encodeURIComponent(effectiveApiKey)}&alt=sse`;
  case 'geminiEmbedContent':
  return `${baseUrl}/v1beta/models/${encodeURIComponent(forwardModel)}:embedContent?key=${encodeURIComponent(effectiveApiKey)}`;
  case 'imageGenerations':
  return baseUrl.includes('/images/generations')
  ? baseUrl
  : appendPath(baseUrl, '/images/generations');
  case 'imageEdits':
  return baseUrl.includes('/images/edits')
  ? baseUrl
  : appendPath(baseUrl, '/images/edits');
  default:
  throw new Error(`Unsupported forwarding endpoint: ${endpoint}`);
  }
}

/**
 * 转发请求到真实的 API
 */
export async function forwardChatRequest(
  model: Model,
  body: ChatCompletionRequest
): Promise<{ success: true; response: any } | { success: false; error: string }> {
  const selectedTarget = selectModelTarget(model, 'chat-completions', body.stream ? 'stream' : 'request');
  const targetModel = applyModelTarget(model, selectedTarget.variant, body.stream ? 'stream' : 'request');
  if (!isModelForwardingConfigured(targetModel)) {
    return { success: false, error: 'Model not configured for forwarding' };
  }
  const apiType = targetModel.api_type || 'openai';

  try {
    const adapter = getProtocolAdapterOrOpenAI(apiType);
    if (!adapter.forwardChat) {
      return { success: false, error: `Protocol adapter '${apiType}' cannot handle chat requests` };
    }
    return await adapter.forwardChat(targetModel, body, selectedTarget.variant);
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Forwarder] Error forwarding to ${apiType}:`, errorMessage);

    // 返回标准化的错误响应
    const standardizedError = standardizeErrorResponse(error, apiType);
    return { success: false, error: JSON.stringify(standardizedError) };
  }
}

export async function forwardEmbeddingsRequest(
  model: Model,
  body: any
): Promise<{ success: true; response: any } | { success: false; error: string }> {
  if (!isModelForwardingConfigured(model)) {
    return { success: false, error: 'Model not configured for forwarding' };
  }

  const apiType = model.api_type || 'openai';

  try {
    const requestedModel = body.model || model.id;
    const forwardModel = getForwardModelName(model, requestedModel);

    if (apiType === 'google') {
      // 对于Google API，使用batchEmbedContents处理批量输入
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      
      if (inputs.length === 1) {
        // 单个输入使用embedContent
        const url = resolveForwardUrl(model, 'geminiEmbedContent', requestedModel, forwardModel);
        console.log(`[Forwarder] Embeddings 转发 URL (embedContent): ${url}`);
        
        const input = inputs[0];
        const googleBody = {
          model: `models/${forwardModel}`,
          content: {
            parts: [{ text: typeof input === 'string' ? input : JSON.stringify(input) }],
          },
        };

        const apiKey = getEffectiveApiKey(model);
        const response = await axios.post(url, googleBody, {
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
          },
          timeout: await getForwarderTimeoutMs(),
        });

        // 转换Google格式到OpenAI格式
        const embedding = response.data.embedding?.values || response.data.values || [];
        return {
          success: true,
          response: {
            object: 'list',
            data: [{
              object: 'embedding',
              embedding,
              index: 0,
            }],
            model: requestedModel,
            usage: {
              prompt_tokens: 0,
              total_tokens: 0,
            },
          },
        };
      } else {
        // 批量输入使用batchEmbedContents
        const baseUrl = model.api_base_url || '';
        const url = `${baseUrl}/v1beta/models/${forwardModel}:batchEmbedContents`;
        console.log(`[Forwarder] Embeddings 转发 URL (batchEmbedContents): ${url}`);
        
        const requests = inputs.map((input: string | any) => ({
          content: {
            parts: [{ text: typeof input === 'string' ? input : JSON.stringify(input) }],
          },
        }));
        
        const googleBody = {
          requests,
        };

        const apiKey = getEffectiveApiKey(model);
        const response = await axios.post(url, googleBody, {
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
          },
          timeout: await getForwarderTimeoutMs(),
        });

        // 转换Google格式到OpenAI格式
        const embeddings = response.data.embeddings || [];
        const data = embeddings.map((item: any, index: number) => ({
          object: 'embedding',
          embedding: item.embedding?.values || item.values || [],
          index,
        }));

        return {
          success: true,
          response: {
            object: 'list',
            data,
            model: requestedModel,
            usage: {
              prompt_tokens: 0,
              total_tokens: 0,
            },
          },
        };
      }
    }

    const url = resolveForwardUrl(model, 'embeddings', requestedModel, forwardModel);
    const forwardBody = { ...body, model: forwardModel };
    const apiKey = getEffectiveApiKey(model);

    console.log(`[Forwarder] Embeddings 转发 URL: ${url}`);
    console.log(`[Forwarder] API Key: ${hideKey(apiKey)}`);
    console.log(`[Forwarder] Request body:`, JSON.stringify(forwardBody));

    const response = await axios.post(url, forwardBody, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    });

    console.log(`[Forwarder] Embeddings response status: ${response.status}`);
    console.log(`[Forwarder] Embeddings response data:`, JSON.stringify(response.data).substring(0, 200));

    // 确保响应数据格式正确
    if (!response.data || !response.data.data || !Array.isArray(response.data.data)) {
      console.error('[Forwarder] Invalid embedding response format:', response.data);
      return { success: false, error: 'Invalid embedding response format' };
    }

    return { success: true, response: response.data };
  } catch (error: any) {
    const standardizedError = standardizeErrorResponse(error, apiType);
    return { success: false, error: JSON.stringify(standardizedError) };
  }
}

export async function forwardImageRequest(
  model: Model,
  body: any,
  endpoint: 'imageGenerations' | 'imageEdits',
  files?: Express.Multer.File[]
): Promise<{ success: true; response: any } | { success: false; error: string }> {
  if (!isModelForwardingConfigured(model)) {
    return { success: false, error: 'Model not configured for forwarding' };
  }

  const apiType = model.api_type || 'openai';

  try {
    const requestedModel = body.model || model.id;
    const forwardModel = getForwardModelName(model, requestedModel);
    const url = resolveForwardUrl(model, endpoint, requestedModel, forwardModel);
    const apiKey = getEffectiveApiKey(model);

    console.log(`[Forwarder] 图片请求转发 URL: ${url}`);
    console.log(`[Forwarder] API Key: ${hideKey(apiKey)}`);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
    };

    if (endpoint === 'imageEdits' && files && files.length > 0) {
      const { readFileSync } = await import('fs');

      const form = new FormData();
      form.append('prompt', body.prompt);
      if (body.model) form.append('model', forwardModel);
      if (body.n) form.append('n', String(body.n));
      if (body.size) form.append('size', body.size);
      if (body.response_format) form.append('response_format', body.response_format);

      for (const f of files) {
        const fileBuffer = readFileSync(f.path);
        const fieldName = f.fieldname || 'image';
        form.append(fieldName, new Blob([fileBuffer], { type: f.mimetype || 'image/png' } as BlobPropertyBag), f.originalname);
      }

      const response = await axios.post(url, form, {
        headers: { ...headers },
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      return { success: true, response: response.data };
    } else {
      const forwardBody: any = { ...body, model: forwardModel };

      const response = await axios.post(url, forwardBody, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        timeout: 120000,
      });

      return { success: true, response: response.data };
    }
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Forwarder] Error forwarding image request:`, errorMessage);
    const standardizedError = standardizeErrorResponse(error, apiType);
    return { success: false, error: JSON.stringify(standardizedError) };
  }
}

/**
 * 转发流式请求
 */
export async function forwardStreamRequest(
  model: Model,
  body: ChatCompletionRequest,
  res: Response,
  onStreamData?: (info: { content: string; reasoningContent?: string | null }) => void
): Promise<void> {
  // 按请求是否流式选择模型的目标协议变体。
  const target = selectModelTarget(model, 'chat-completions', 'stream');
  const targetModel = applyModelTarget(model, target.variant, 'stream');
  if (!isModelForwardingConfigured(targetModel)) {
    throw new Error('Model not configured for forwarding');
  }
  const apiType = targetModel.api_type || 'openai-chat';
  
  if (apiType === 'anthropic') {
    return forwardAnthropicStream(targetModel, body, res);
  }

  if (apiType === 'google') {
    return forwardGoogleChatStream(targetModel, body, res, onStreamData);
  }

  if (target.variant === 'responses') {
    return forwardOpenAIResponsesStream(targetModel, body, res, onStreamData);
  }

  // 生成统一的请求 ID
  const requestId = generateRequestId();

  // 设置流式响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const forwardModel = getForwardModelName(targetModel, body.model);
  const url = resolveForwardUrl(targetModel, 'chat', body.model, forwardModel);
  const apiKey = getEffectiveApiKey(targetModel);

  console.log(`[Forwarder] 流式转发 URL: ${url}`);
  console.log(`[Forwarder] API Key: ${hideKey(apiKey)}`);

  // 使用转发模型名称
  const forwardBody = { ...body, model: forwardModel };

  // 透传工具调用中的 thought_signature（不注入空值）
  // Gemini 3 系列模型会验证 thought_signature，空值会导致 "Corrupted thought signature" 错误
  if (forwardBody.tools || forwardBody.functions) {
    const hasThoughtSig = (obj: any) => obj && typeof obj.thought_signature === 'string' && obj.thought_signature.length > 0;

    // 处理 tools 数组：只保留已有的有效 thought_signature，不注入空值
    if (forwardBody.tools && Array.isArray(forwardBody.tools)) {
      forwardBody.tools = forwardBody.tools.map((tool: any) => {
        if (tool.type === 'function' && tool.function) {
          // 如果已有有效的 thought_signature 则保留，否则移除该字段
          if (!hasThoughtSig(tool.function)) {
            delete tool.function.thought_signature;
          }
        }
        return tool;
      });
    }

    // 处理 functions 数组（旧版格式）
    if (forwardBody.functions && Array.isArray(forwardBody.functions)) {
      forwardBody.functions = forwardBody.functions.map((func: any) => {
        if (!hasThoughtSig(func)) {
          delete func.thought_signature;
        }
        return func;
      });
    }

    // 处理 tool_choice
    if (forwardBody.tool_choice && typeof forwardBody.tool_choice === 'object') {
      if (!hasThoughtSig(forwardBody.tool_choice)) {
        delete forwardBody.tool_choice.thought_signature;
      }
    }
  }

  const response = await axios.post(url, forwardBody, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
    responseType: 'stream',
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    httpAgent: new (require('http').Agent)({ keepAlive: true }),
    httpsAgent: new (require('https').Agent)({ keepAlive: true }),
  });

  let clientClosed = false;

  // 监听客户端断开连接
  res.on('close', () => {
    if (!clientClosed) {
      clientClosed = true;
      console.log('[Forwarder] Client disconnected, stopping stream');
      // 停止上游流
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
    }
  });

  // 处理流数据，统一 id 格式，并提取 reasoning_content
  let firstChunk = true;
  let buffer = '';
  response.data.on('data', (chunk: Buffer) => {
    if (clientClosed) return;
    
    let chunkStr = chunk.toString();
    
    // 替换流中的 id 为统一格式
    chunkStr = chunkStr.replace(
      /"id"\s*:\s*"[^"]*"/g,
      `"id":"${requestId}"`
    );
    
    res.write(chunkStr);
    
    // 回调通知：解析结构化数据
    if (onStreamData) {
      buffer += chunkStr;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (choice) {
              const content = choice.delta?.content || '';
              const reasoningContent = choice.delta?.reasoning_content;
              if (content || reasoningContent) {
                onStreamData({
                  content,
                  reasoningContent: reasoningContent || null,
                });
              }
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  });

  response.data.on('end', () => {
    if (!clientClosed) {
      res.end();
    }
  });

  response.data.on('error', (err: Error) => {
    console.error('[Forwarder] Stream error:', err.message);
    if (!clientClosed) {
      res.end();
    }
  });
}

/**
 * 转发到 OpenAI 兼容的 API
 */
async function forwardToOpenAI(
  model: Model,
  body: ChatCompletionRequest,
  targetVariant: ForwardVariant = 'chat-completions',
): Promise<{ success: true; response: any }> {
  const forwardModel = getForwardModelName(model, body.model);
  const url = resolveForwardUrl(model, 'chat', body.model, forwardModel);
  const apiKey = getEffectiveApiKey(model);

  console.log(`[Forwarder] 转发 URL: ${url}`);
  console.log(`[Forwarder] API Key: ${hideKey(apiKey)}`);

  // 使用转发模型名称
  const forwardBody = { ...body, model: forwardModel };

  // OpenAI Responses 是另一种请求/响应协议，不能直接复用 Chat JSON。
  if (targetVariant === 'responses') {
    const responseBody = toOpenAIResponsesBody(body, forwardModel);
    const response = await axios.post(url, responseBody, axiosConfigFor(model, false));
    return { success: true, response: fromOpenAIResponsesBody(response.data, body.model) };
  }

  // 透传工具调用中的 thought_signature（不注入空值）
  // Gemini 3 系列模型会验证 thought_signature，空值会导致 "Corrupted thought signature" 错误
  if (forwardBody.tools || forwardBody.functions) {
    const hasThoughtSig = (obj: any) => obj && typeof obj.thought_signature === 'string' && obj.thought_signature.length > 0;

    // 处理 tools 数组：只保留已有的有效 thought_signature，不注入空值
    if (forwardBody.tools && Array.isArray(forwardBody.tools)) {
      forwardBody.tools = forwardBody.tools.map((tool: any) => {
        if (tool.type === 'function' && tool.function) {
          if (!hasThoughtSig(tool.function)) {
            delete tool.function.thought_signature;
          }
        }
        return tool;
      });
    }

    // 处理 functions 数组（旧版格式）
    if (forwardBody.functions && Array.isArray(forwardBody.functions)) {
      forwardBody.functions = forwardBody.functions.map((func: any) => {
        if (!hasThoughtSig(func)) {
          delete func.thought_signature;
        }
        return func;
      });
    }

    // 处理 tool_choice
    if (forwardBody.tool_choice && typeof forwardBody.tool_choice === 'object') {
      if (!hasThoughtSig(forwardBody.tool_choice)) {
        delete forwardBody.tool_choice.thought_signature;
      }
    }
  }

  const baseHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // 合并默认请求头（模型级别配置的默认请求头）
  const headers = mergeHeaders(model.defaultHeaders, baseHeaders);

  const axiosConfig: any = {
    headers,
    timeout: await getForwarderTimeoutMs(), // 1000 秒超时
  };

  if (body.stream) {
    axiosConfig.responseType = 'stream';
    axiosConfig.maxContentLength = Infinity;
    axiosConfig.maxBodyLength = Infinity;
    // 流式请求不设置 Content-Length
    delete axiosConfig.headers['Content-Length'];
  } else {
    axiosConfig.responseType = 'json';
  }

  const response = await axios.post(url, forwardBody, axiosConfig);

  // 非流式响应：统一 id 格式
  if (!body.stream && response.data) {
    response.data.id = generateRequestId();
  }

  return { success: true, response: response.data };
}

export async function forwardResponsesRequest(
  model: Model,
  body: any,
): Promise<{ success: true; response: any } | { success: false; error: string }> {
  const target = selectModelTarget(model, 'responses', body.stream === true ? 'stream' : 'request');
  if (target.variant !== 'responses') {
    return { success: false, error: 'No Responses protocol target configured for this model' };
  }

  const targetModel = applyModelTarget(model, target.variant, body.stream === true ? 'stream' : 'request');
  if (!isModelForwardingConfigured(targetModel)) {
    return { success: false, error: 'Model not configured for forwarding' };
  }

  const forwardModel = getForwardModelName(targetModel, body.model);
  const url = resolveForwardUrl(targetModel, 'responses', body.model, forwardModel);
  const responseBody = { ...body, model: forwardModel };
  try {
    const response = await axios.post(url, responseBody, axiosConfigFor(targetModel, body.stream === true));
    return { success: true, response: response.data };
  } catch (error: any) {
    return { success: false, error: JSON.stringify(standardizeErrorResponse(error, targetModel.api_type || 'openai')) };
  }
}

function axiosConfigFor(model: Model, stream: boolean): any {
  const apiKey = getEffectiveApiKey(model);
  const config: any = {
    headers: mergeHeaders(model.defaultHeaders, {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
    timeout: 120000,
    responseType: stream ? 'stream' : 'json',
  };
  if (stream) {
    config.maxContentLength = Infinity;
    config.maxBodyLength = Infinity;
  }
  return config;
}

async function forwardOpenAIResponsesStream(
  model: Model,
  body: ChatCompletionRequest,
  res: Response,
  onStreamData?: (info: { content: string; reasoningContent?: string | null }) => void,
): Promise<void> {
  const forwardModel = getForwardModelName(model, body.model);
  const url = resolveForwardUrl(model, 'responses', body.model, forwardModel);
  const response = await axios.post(url, toOpenAIResponsesBody(body, forwardModel), axiosConfigFor(model, true));
  const requestId = generateRequestId();
  let closed = false;
  let buffer = '';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.on('close', () => {
    closed = true;
    response.data?.destroy?.();
  });

  response.data.on('data', (chunk: Buffer) => {
    if (closed) return;
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const event = JSON.parse(raw);
        const text = event.type === 'response.output_text.delta' ? event.delta || '' : '';
        if (text) {
          res.write(`data: ${JSON.stringify({
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          })}\n\n`);
          onStreamData?.({ content: text });
        }
        if (event.type === 'response.completed') {
          res.write(`data: ${JSON.stringify({
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
        }
      } catch {
        // Keep incomplete SSE data until the next transport chunk.
      }
    }
  });
  response.data.on('end', () => {
    if (!closed) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });
  response.data.on('error', (error: Error) => {
    if (!closed) res.destroy(error);
  });
}

/**
 * 将 OpenAI 格式转换为 Anthropic 格式
 */
function convertOpenAIToAnthropic(
  body: ChatCompletionRequest,
  modelId: string
): any {
  // 提取系统消息
  let systemContent = '';
  const messages = [];

  for (const msg of body.messages) {
    if (msg.role === 'system') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      systemContent += (systemContent ? '\n' : '') + content;
    } else {
      const msgContent = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
        ? msg.content
            .map((item: any) => {
              if (item.type === 'text') return item.text;
              if (item.type === 'image_url') return `[Image: ${item.image_url?.url}]`;
              return '';
            })
            .join('\n')
        : '';

      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msgContent,
      });
    }
  }

  const anthropicBody: any = {
    model: modelId,
    max_tokens: body.max_tokens || 1024,
    messages,
    stream: true, // 对于流式请求，始终启用 stream
  };

  if (systemContent) {
    anthropicBody.system = systemContent;
  }

  if (body.temperature !== undefined) {
    anthropicBody.temperature = body.temperature;
  }

  if (body.top_p !== undefined) {
    anthropicBody.top_p = body.top_p;
  }

  return anthropicBody;
}

/**
 * 转发 Anthropic 流式请求，转换为 OpenAI SSE 格式
 */
async function forwardAnthropicStream(
  model: Model,
  body: ChatCompletionRequest,
  res: Response,
  onStreamData?: (info: { content: string; reasoningContent?: string | null }) => void
): Promise<void> {
  // 生成统一的请求 ID
  const requestId = generateRequestId();

  // 设置流式响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const forwardModel = getForwardModelName(model, body.model);
  const url = resolveForwardUrl(model, 'anthropicMessages', body.model, forwardModel);
  const apiKey = getEffectiveApiKey(model);

  console.log(`[Forwarder] Anthropic 流式转发 URL: ${url}`);
  console.log(`[Forwarder] API Key: ${hideKey(apiKey)}`);

  // 转换消息格式：OpenAI -> Anthropic
  const anthropicBody = convertOpenAIToAnthropic(body, forwardModel);

  const baseHeaders = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };

  // 合并默认请求头
  const headers = mergeHeaders(model.defaultHeaders, baseHeaders);

  const axiosConfig: any = {
    headers,
    timeout: 120000,
    responseType: 'stream',
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  };

  try {
    const response = await axios.post(url, anthropicBody, axiosConfig);

    let clientClosed = false;

    // 监听客户端断开连接
    res.on('close', () => {
      if (!clientClosed) {
        clientClosed = true;
        console.log('[Forwarder] Anthropic Stream - Client disconnected');
        if (response.data && typeof response.data.destroy === 'function') {
          response.data.destroy();
        }
      }
    });

    // 跟踪 thinking 状态
    let thinkingContent = '';
    let inThinkingBlock = false;

    // 处理 Anthropic SSE 流，转换为 OpenAI 格式
    response.data.on('data', (chunk: Buffer) => {
      if (clientClosed) return;

      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            // 处理 content_block_start（可能包含 thinking 块）
            if (data.type === 'content_block_start') {
              if (data.content_block?.type === 'thinking') {
                inThinkingBlock = true;
                thinkingContent = data.content_block.thinking || '';
                // 发出 reasoning_content 块
                const openaiChunk = {
                  id: requestId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: body.model,
                  choices: [{
                    index: 0,
                    delta: { content: '', reasoning_content: thinkingContent },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                onStreamData?.({ content: '', reasoningContent: thinkingContent });
                return;
              }
              if (data.content_block?.type === 'redacted_thinking') {
                inThinkingBlock = true;
                thinkingContent = data.content_block.data || '';
                const openaiChunk = {
                  id: requestId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: body.model,
                  choices: [{
                    index: 0,
                    delta: { content: '', reasoning_content: '[Thinking redacted]' },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                onStreamData?.({ content: '', reasoningContent: '[Thinking redacted]' });
                return;
              }
              inThinkingBlock = false;
            }

            // 处理 content_block_delta
            if (data.type === 'content_block_delta') {
              const delta = data.delta;
              if (delta.type === 'text_delta') {
                inThinkingBlock = false;
                const openaiChunk = {
                  id: requestId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: body.model,
                  choices: [{
                    index: 0,
                    delta: { content: delta.text || '' },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                onStreamData?.({ content: delta.text || '' });
              }
              if (delta.type === 'thinking_delta') {
                thinkingContent += delta.thinking || '';
                const openaiChunk = {
                  id: requestId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: body.model,
                  choices: [{
                    index: 0,
                    delta: { content: '', reasoning_content: delta.thinking || '' },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                onStreamData?.({ content: '', reasoningContent: delta.thinking || '' });
              }
              if (delta.type === 'signature_delta') {
                // 透传 thought_signature，客户端可能在后续请求中需要
                const openaiChunk = {
                  id: requestId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: body.model,
                  choices: [{
                    index: 0,
                    delta: { content: '', thought_signature: delta.signature || '' },
                    finish_reason: null,
                  }],
                };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
              }
            }

            // 处理 content_block_stop
            if (data.type === 'content_block_stop') {
              inThinkingBlock = false;
            }

            // 处理 message_stop 事件
            if (data.type === 'message_stop') {
              inThinkingBlock = false;
              const openaiChunk = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [{
                  index: 0,
                  delta: { content: '' },
                  finish_reason: 'stop',
                }],
              };
              res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
              res.write('data: [DONE]\n\n');
            }
          } catch (e) {
            // 忽略解析错误
            console.error('[Forwarder] Anthropic stream parsing error:', e);
          }
        }
      }
    });

    response.data.on('end', () => {
      if (!clientClosed) {
        if (!response.data.terminated) {
          res.write('data: [DONE]\n\n');
        }
        res.end();
      }
    });

    response.data.on('error', (err: Error) => {
      console.error('[Forwarder] Anthropic stream error:', err.message);
      if (!clientClosed) {
        res.end();
      }
    });
  } catch (error: any) {
    console.error('[Forwarder] Anthropic stream request failed:', error.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: {
          message: `Anthropic streaming failed: ${error.message}`,
          type: 'forwarding_error',
          code: 'anthropic_stream_failed',
        },
      });
    } else {
      res.end();
    }
  }
}

/**
 * 转发到 Anthropic API
 */
async function forwardToAnthropic(
  model: Model,
  body: ChatCompletionRequest
): Promise<{ success: true; response: any }> {
  // 使用转发模型名称
  const forwardModel = getForwardModelName(model, body.model);
  const url = resolveForwardUrl(model, 'anthropicMessages', body.model, forwardModel);
  const apiKey = getEffectiveApiKey(model);

  console.log(`[Forwarder] Anthropic 转发 URL: ${url}`);
  console.log(`[Forwarder] API Key: ${hideKey(apiKey)}`);

  // 转换消息格式：OpenAI -> Anthropic
  const systemMessages = body.messages.filter(m => m.role === 'system');
  const nonSystemMessages = body.messages.filter(m => m.role !== 'system');

  const anthropicBody = {
    model: forwardModel,
    messages: nonSystemMessages.map(m => {
      // 正确处理多模态消息
      let content: any;
      if (typeof m.content === 'string') {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        // 转换OpenAI的多模态格式到Anthropic格式
        content = m.content.map((item: any) => {
          if (item.type === 'text') {
            return { type: 'text', text: item.text };
          } else if (item.type === 'image_url') {
            // Anthropic使用不同的图片格式
            return {
              type: 'image',
              source: {
                type: 'url',
                url: item.image_url?.url || '',
              },
            };
          }
          return item;
        });
      } else {
        // 其他情况保持原样
        content = m.content;
      }
      
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content,
      };
    }),
    max_tokens: body.max_tokens || 4096,
    temperature: body.temperature,
    top_p: body.top_p,
    stream: body.stream,
    system: systemMessages.length > 0 ? systemMessages[0].content : undefined,
  };

  const baseHeaders = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };

  // 合并默认请求头
  const headers = mergeHeaders(model.defaultHeaders, baseHeaders);

  const axiosConfig: any = {
    headers,
    timeout: 120000,
  };

  if (body.stream) {
    axiosConfig.responseType = 'stream';
    axiosConfig.maxContentLength = Infinity;
    axiosConfig.maxBodyLength = Infinity;
  } else {
    axiosConfig.responseType = 'json';
  }

  let response;
  try {
    response = await axios.post(url, anthropicBody, axiosConfig);
  } catch (error: any) {
    console.error('[Forwarder] Anthropic request failed:', error.message);
    if (error.response) {
      console.error('[Forwarder] Response status:', error.response.status);
      console.error('[Forwarder] Response data:', JSON.stringify(error.response.data));
    }
    throw error;
  }

  // 转换响应格式：Anthropic -> OpenAI
  if (!body.stream) {
    const anthropicResponse = response.data;
    return {
      success: true,
      response: {
        id: generateRequestId(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: anthropicResponse.content[0]?.text || '',
          },
          finish_reason: anthropicResponse.stop_reason === 'end_turn' ? 'stop' : 'length',
        }],
        usage: {
          prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
          completion_tokens: anthropicResponse.usage?.output_tokens || 0,
          total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0),
        },
      },
    };
  }

  // 流式响应：转换 Anthropic SSE 格式为 OpenAI SSE 格式
  const { Readable } = require('stream');
  const transformedStream = new Readable({
    read() {},
  });

  if (response.data && typeof response.data.on === 'function') {
    response.data.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            // 处理 Anthropic 的 content_block_delta 事件
            if (data.type === 'content_block_delta') {
              const delta = data.delta;
              if (delta.type === 'text_delta') {
                const openaiChunk = {
                  id: generateRequestId(),
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: body.model,
                  choices: [{
                    index: 0,
                    delta: { content: delta.text || '' },
                    finish_reason: null,
                  }],
                };
                transformedStream.push(`data: ${JSON.stringify(openaiChunk)}\n`);
              }
            }
            
            // 处理 message_stop 事件
            if (data.type === 'message_stop') {
              const openaiChunk = {
                id: generateRequestId(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [{
                  index: 0,
                  delta: { content: '' },
                  finish_reason: 'stop',
                }],
              };
              transformedStream.push(`data: ${JSON.stringify(openaiChunk)}\n`);
              transformedStream.push('data: [DONE]\n');
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    });

    response.data.on('error', (error: any) => {
      transformedStream.destroy(error);
    });

    response.data.on('end', () => {
      transformedStream.push(null);
    });
  }

  return { success: true, response: transformedStream };
}

function toGoogleChatBody(body: ChatCompletionRequest): any {
  const systemMessages = body.messages.filter(message => message.role === 'system');
  const contents = body.messages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: typeof message.content === 'string'
        ? [{ text: message.content }]
        : message.content.map((item: any) => {
          if (item.type === 'text') return { text: item.text || '' };
          if (item.type === 'image_url') {
            const value = item.image_url?.url || '';
            const match = value.match(/^data:([^;]+);base64,(.+)$/);
            return match
              ? { inlineData: { mimeType: match[1], data: match[2] } }
              : { text: `[Image: ${value}]` };
          }
          return { text: JSON.stringify(item) };
        }),
    }));

  const generationConfig: Record<string, unknown> = {};
  if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
  if (body.top_p !== undefined) generationConfig.topP = body.top_p;
  if (body.max_tokens !== undefined) generationConfig.maxOutputTokens = body.max_tokens;

  return {
    ...(systemMessages.length > 0 ? {
      systemInstruction: {
        parts: systemMessages.map(message => ({
          text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        })),
      },
    } : {}),
    contents,
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
}

async function forwardGoogleChatStream(
  model: Model,
  body: ChatCompletionRequest,
  res: Response,
  onStreamData?: (info: { content: string; reasoningContent?: string | null }) => void
): Promise<void> {
  const forwardModel = getForwardModelName(model, body.model);
  const url = resolveForwardUrl(model, 'geminiStreamGenerateContent', body.model, forwardModel);
  const apiKey = getEffectiveApiKey(model);
  const response = await axios.post(url, toGoogleChatBody(body), {
    headers: mergeHeaders(model.defaultHeaders, {
      'Content-Type': 'application/json',
    }),
    timeout: await getForwarderTimeoutMs(),
    responseType: 'stream',
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let closed = false;
  let buffer = '';
  res.on('close', () => {
    closed = true;
    response.data?.destroy?.();
  });

  response.data.on('data', (chunk: Buffer) => {
    if (closed) return;
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const raw = line.trim();
      if (!raw || raw === 'data: [DONE]') continue;
      const payload = raw.startsWith('data:') ? raw.slice(5).trim() : raw;
      try {
        const data = JSON.parse(payload);
        const text = data.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || '';
        if (!text) continue;
        const chunkResponse = {
          id: generateRequestId(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunkResponse)}\n\n`);
        onStreamData?.({ content: text });
      } catch {
        // Gemini may split JSON across transport chunks; keep the remainder buffered.
      }
    }
  });
  response.data.on('end', () => {
    if (!closed) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });
  response.data.on('error', (error: Error) => {
    if (!closed) res.destroy(error);
  });
}

/**
 * 转发到 Google Gemini API
 */
async function forwardToGoogle(
  model: Model,
  body: ChatCompletionRequest
): Promise<{ success: true; response: any }> {
  const forwardModel = getForwardModelName(model, body.model);
  const url = resolveForwardUrl(model, 'geminiGenerateContent', body.model, forwardModel);

  console.log(`[Forwarder] Gemini 转发 URL: ${url}`);

  const googleBody = toGoogleChatBody(body);

  const response = await axios.post(url, googleBody, {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  // 转换响应格式：Google -> OpenAI
  const googleResponse = response.data;
  const candidate = googleResponse.candidates?.[0];

  return {
    success: true,
    response: {
      id: generateRequestId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: candidate?.content?.parts?.[0]?.text || '',
        },
        finish_reason: candidate?.finishReason === 'STOP' ? 'stop' : 'length',
      }],
      usage: {
        prompt_tokens: googleResponse.usageMetadata?.promptTokenCount || 0,
        completion_tokens: googleResponse.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: googleResponse.usageMetadata?.totalTokenCount || 0,
      },
    },
  };
}

/**
 * 转发 Gemini 格式的请求（非流式）
 * 根据 api_type 决定如何转发和转换格式
 */
export async function forwardGeminiRequest(
  model: Model,
  geminiBody: any
): Promise<{ success: true; response: any } | { success: false; error: string }> {
  if (!isModelForwardingConfigured(model)) {
    return { success: false, error: 'Model not configured for forwarding' };
  }

  const apiType = model.api_type || 'google';

  try {
    // 如果目标是 Google/Gemini API，直接转发 Gemini 格式
    if (apiType === 'google') {
      const forwardModel = model.forwardModelName || model.id;
      const url = resolveForwardUrl(model, 'geminiGenerateContent', model.id, forwardModel);

      console.log(`[Gemini Forwarder] 转发到 Gemini API: ${url}`);

      const response = await axios.post(url, geminiBody, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      });

      return { success: true, response: response.data };
    }

    // 如果目标是其他 API（OpenAI、Anthropic 等），需要转换格式
    // 1. 将 Gemini 格式转换为 OpenAI 格式
    const messages: ChatCompletionRequest['messages'] = [];

    // 提取 system instruction
    if (geminiBody.systemInstruction?.parts) {
      const systemContent = geminiBody.systemInstruction.parts
        .map((p: { text?: string }) => p.text || '')
        .join('\n');
      if (systemContent) {
        messages.push({ role: 'system', content: systemContent });
      }
    }

    // 提取 contents
    if (geminiBody.contents) {
      geminiBody.contents.forEach((item: { role: string; parts: { text?: string }[] }) => {
        const content = item.parts
          .map((p: { text?: string }) => p.text || '')
          .join('\n');
        const role = item.role === 'model' ? 'assistant' : item.role;
        messages.push({ role, content });
      });
    }

    const openaiBody: ChatCompletionRequest = {
      model: model.forwardModelName || model.id,
      messages,
      stream: false,
      temperature: geminiBody.generationConfig?.temperature,
      top_p: geminiBody.generationConfig?.topP,
      max_tokens: geminiBody.generationConfig?.maxOutputTokens,
    };

    console.log(`[Gemini Forwarder] 转换为 OpenAI 格式，转发到 ${apiType} API`);

    // 2. 使用现有的转发函数
    const result = await forwardChatRequest(model, openaiBody);

    if (!result.success) {
      return result;
    }

    // 3. 将 OpenAI 响应转换回 Gemini 格式
    const openaiResponse = result.response;
    const geminiResponse = {
      candidates: [{
        content: {
          parts: [{ text: openaiResponse.choices?.[0]?.message?.content || '' }],
          role: 'model',
        },
        finishReason: openaiResponse.choices?.[0]?.finish_reason === 'stop' ? 'STOP' : 'MAX_TOKENS',
      }],
      usageMetadata: {
        promptTokenCount: openaiResponse.usage?.prompt_tokens || 0,
        candidatesTokenCount: openaiResponse.usage?.completion_tokens || 0,
        totalTokenCount: openaiResponse.usage?.total_tokens || 0,
      },
    };

    return { success: true, response: geminiResponse };
  } catch (error: any) {
    const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
    console.error('[Gemini Forwarder] 转发失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 转发 Gemini 格式的请求（流式）
 * 根据 api_type 决定如何转发和转换格式
 */
export async function forwardGeminiStreamRequest(
  model: Model,
  geminiBody: any,
  res: Response
): Promise<void> {
  if (!isModelForwardingConfigured(model)) {
    throw new Error('Model not configured for forwarding');
  }

  const apiType = model.api_type || 'google';

  // 设置流式响应头（Gemini 格式）
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // 如果目标是 Google/Gemini API，直接转发
  if (apiType === 'google') {
    const forwardModel = model.forwardModelName || model.id;
    const url = resolveForwardUrl(model, 'geminiStreamGenerateContent', model.id, forwardModel);

    console.log(`[Gemini Forwarder] 流式转发到 Gemini API: ${url}`);

    const response = await axios.post(url, geminiBody, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 120000,
      responseType: 'stream',
    });

    let clientClosed = false;

    // 监听客户端断开连接
    res.on('close', () => {
      if (!clientClosed) {
        clientClosed = true;
        console.log('[Gemini Forwarder] Client disconnected, stopping stream');
        if (response.data && typeof response.data.destroy === 'function') {
          response.data.destroy();
        }
      }
    });

    // 直接透传流数据
    response.data.on('data', (chunk: Buffer) => {
      if (clientClosed) return;
      res.write(chunk);
    });

    response.data.on('end', () => {
      if (!clientClosed) {
        res.end();
      }
    });

    response.data.on('error', (err: Error) => {
      console.error('[Gemini Forwarder] 流式转发错误:', err.message);
      if (!clientClosed) {
        res.end();
      }
    });
    return;
  }

  // 如果目标是其他 API，需要转换格式
  // 1. 将 Gemini 格式转换为 OpenAI 格式
  const messages: ChatCompletionRequest['messages'] = [];

  if (geminiBody.systemInstruction?.parts) {
    const systemContent = geminiBody.systemInstruction.parts
      .map((p: { text?: string }) => p.text || '')
      .join('\n');
    if (systemContent) {
      messages.push({ role: 'system', content: systemContent });
    }
  }

  if (geminiBody.contents) {
    geminiBody.contents.forEach((item: { role: string; parts: { text?: string }[] }) => {
      const content = item.parts
        .map((p: { text?: string }) => p.text || '')
        .join('\n');
      const role = item.role === 'model' ? 'assistant' : item.role;
      messages.push({ role, content });
    });
  }

  const forwardModel = model.forwardModelName || model.id;
  const openaiBody: ChatCompletionRequest = {
    model: forwardModel,
    messages,
    stream: true,
    temperature: geminiBody.generationConfig?.temperature,
    top_p: geminiBody.generationConfig?.topP,
    max_tokens: geminiBody.generationConfig?.maxOutputTokens,
  };

  console.log(`[Gemini Forwarder] 流式转换为 OpenAI 格式，转发到 ${apiType} API`);

  // 2. 转发 OpenAI 格式请求
  const url = resolveForwardUrl(model, 'chat', model.id, forwardModel);
  const apiKey = getEffectiveApiKey(model);

  const response = await axios.post(url, openaiBody, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
    responseType: 'stream',
  });

  let clientClosed = false;

  // 监听客户端断开连接
  res.on('close', () => {
    if (!clientClosed) {
      clientClosed = true;
      console.log('[Gemini Forwarder] Client disconnected, stopping stream');
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
    }
  });

  // 3. 将 OpenAI 流式响应转换为 Gemini 格式
  let buffer = '';
  
  response.data.on('data', (chunk: Buffer) => {
    if (clientClosed) return;
    
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }

        try {
          const openaiChunk = JSON.parse(data);
          const content = openaiChunk.choices?.[0]?.delta?.content || '';
          
          if (content) {
            // 转换为 Gemini 格式
            const geminiChunk = {
              candidates: [{
                content: {
                  parts: [{ text: content }],
                  role: 'model',
                },
                finishReason: openaiChunk.choices?.[0]?.finish_reason ? 'STOP' : null,
              }],
            };
            res.write(`data: ${JSON.stringify(geminiChunk)}\n\n`);
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  });

  response.data.on('end', () => {
    if (!clientClosed) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });

  response.data.on('error', (err: Error) => {
    console.error('[Gemini Forwarder] 流式转换错误:', err.message);
    if (!clientClosed) {
      res.end();
    }
  });
}
