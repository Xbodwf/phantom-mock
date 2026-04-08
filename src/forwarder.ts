import axios from 'axios';
import type { ChatCompletionRequest, Model } from './types.js';
import type { Response } from 'express';
import { generateRequestId } from './responseBuilder.js';
import { getProviderById, getNodeById } from './storage.js';

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
function getEffectiveApiKey(model: Model): string {
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

 // 检查是否有 api_key 和 api_base_url
 return !!model.api_key && !!model.api_base_url;
}

type ForwardEndpoint =
 | 'chat'
 | 'embeddings'
 | 'rerank'
 | 'anthropicMessages'
 | 'geminiGenerateContent'
 | 'geminiStreamGenerateContent'
 | 'geminiEmbedContent';

function normalizeBaseUrl(baseUrl: string): string {
 return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function appendPath(baseUrl: string, path: string): string {
 const normalizedBase = normalizeBaseUrl(baseUrl);
 const normalizedPath = path.startsWith('/') ? path : `/${path}`;
 return `${normalizedBase}${normalizedPath}`;
}

export function resolveForwardUrl(
 model: Model,
 endpoint: ForwardEndpoint,
 requestedModel: string,
 forwardModel: string
): string {
 // 从 model 或 provider 或 node 获取配置
 let effectiveBaseUrl = model.api_base_url || '';
 let effectiveApiKey = model.api_key || '';

 // 如果 model 已经有 api_key 和 api_base_url，直接使用（可能是 runtimeModel）
 const hasRuntimeConfig = model.api_key && model.api_base_url;

 // 如果配置了 provider 且没有 runtime config，从 provider 获取 base URL 和 key
 if (!hasRuntimeConfig && model.forwardingMode === 'provider' && model.providerId) {
 const provider = getProviderById(model.providerId);
 if (provider) {
 effectiveBaseUrl = provider.api_base_url || effectiveBaseUrl;
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

 if (!effectiveApiKey) {
 throw new Error('Model not configured for forwarding: missing api_key');
 }

 // 优先使用 api_url_path
 const api_url_path = model.api_url_path;
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
  if (!isModelForwardingConfigured(model)) {
    return { success: false, error: 'Model not configured for forwarding' };
  }

  const apiType = model.api_type || 'openai';

  try {
    switch (apiType) {
      case 'openai':
      case 'azure':
      case 'custom':
        return await forwardToOpenAI(model, body);

      case 'anthropic':
        return await forwardToAnthropic(model, body);

      case 'google':
        return await forwardToGoogle(model, body);

      default:
        return { success: false, error: `Unsupported API type: ${apiType}` };
    }
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
      const url = resolveForwardUrl(model, 'geminiEmbedContent', requestedModel, forwardModel);
      console.log(`[Forwarder] Embeddings 转发 URL: ${url}`);
      const input = Array.isArray(body.input) ? body.input[0] : body.input;
      const googleBody = {
        model: `models/${forwardModel}`,
        content: {
          parts: [{ text: typeof input === 'string' ? input : JSON.stringify(input) }],
        },
      };

      const response = await axios.post(url, googleBody, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      });

      return { success: true, response: response.data };
    }

    const url = resolveForwardUrl(model, 'embeddings', requestedModel, forwardModel);
    const forwardBody = { ...body, model: forwardModel };
    const apiKey = getEffectiveApiKey(model);

    console.log(`[Forwarder] Embeddings 转发 URL: ${url}`);
    console.log(`[Forwarder] API Key: ${hideKey(apiKey)}`);

    const response = await axios.post(url, forwardBody, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    });

    return { success: true, response: response.data };
  } catch (error: any) {
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
  res: Response
): Promise<void> {
  if (!isModelForwardingConfigured(model)) {
    throw new Error('Model not configured for forwarding');
  }

  // 生成统一的请求 ID
  const requestId = generateRequestId();

  // 设置流式响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const forwardModel = getForwardModelName(model, body.model);
  const url = resolveForwardUrl(model, 'chat', body.model, forwardModel);
  const apiKey = getEffectiveApiKey(model);

  console.log(`[Forwarder] 流式转发 URL: ${url}`);
  console.log(`[Forwarder] API Key: ${hideKey(apiKey)}`);

  // 使用转发模型名称
  const forwardBody = { ...body, model: forwardModel };

  // 检查并修复工具调用中的 thought_signature（与 forwardToOpenAI 相同）
  if (forwardBody.tools || forwardBody.functions) {
    console.log('[Forwarder] 流式请求检测到工具调用，确保 thought_signature 存在');
    
    // 处理 tools 数组
    if (forwardBody.tools && Array.isArray(forwardBody.tools)) {
      forwardBody.tools = forwardBody.tools.map((tool: any) => {
        if (tool.type === 'function' && tool.function) {
          // 确保 function 对象有 thought_signature
          if (!tool.function.thought_signature) {
            tool.function.thought_signature = '';
          }
        }
        return tool;
      });
    }
    
    // 处理 functions 数组（旧版格式）
    if (forwardBody.functions && Array.isArray(forwardBody.functions)) {
      forwardBody.functions = forwardBody.functions.map((func: any) => {
        if (!func.thought_signature) {
          func.thought_signature = '';
        }
        return func;
      });
    }
    
    // 处理 tool_choice
    if (forwardBody.tool_choice && typeof forwardBody.tool_choice === 'object') {
      if (!forwardBody.tool_choice.thought_signature) {
        forwardBody.tool_choice.thought_signature = '';
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

  // 处理流数据，统一 id 格式
  let firstChunk = true;
  response.data.on('data', (chunk: Buffer) => {
    if (clientClosed) return;
    
    let chunkStr = chunk.toString();
    
    // 替换流中的 id 为统一格式
    // 匹配 "id":"xxx" 或 "id": "xxx" 格式
    chunkStr = chunkStr.replace(
      /"id"\s*:\s*"[^"]*"/g,
      `"id":"${requestId}"`
    );
    
    res.write(chunkStr);
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
  body: ChatCompletionRequest
): Promise<{ success: true; response: any }> {
  const forwardModel = getForwardModelName(model, body.model);
  const url = resolveForwardUrl(model, 'chat', body.model, forwardModel);
  const apiKey = getEffectiveApiKey(model);

  console.log(`[Forwarder] 转发 URL: ${url}`);
  console.log(`[Forwarder] API Key: ${hideKey(apiKey)}`);

  // 使用转发模型名称
  const forwardBody = { ...body, model: forwardModel };

  // 检查并修复工具调用中的 thought_signature
  // 某些 OpenAI 兼容的 API 需要这个字段
  if (forwardBody.tools || forwardBody.functions) {
    console.log('[Forwarder] 检测到工具调用，确保 thought_signature 存在');
    
    // 处理 tools 数组
    if (forwardBody.tools && Array.isArray(forwardBody.tools)) {
      forwardBody.tools = forwardBody.tools.map((tool: any) => {
        if (tool.type === 'function' && tool.function) {
          // 确保 function 对象有 thought_signature
          if (!tool.function.thought_signature) {
            tool.function.thought_signature = '';
          }
        }
        return tool;
      });
    }
    
    // 处理 functions 数组（旧版格式）
    if (forwardBody.functions && Array.isArray(forwardBody.functions)) {
      forwardBody.functions = forwardBody.functions.map((func: any) => {
        if (!func.thought_signature) {
          func.thought_signature = '';
        }
        return func;
      });
    }
    
    // 处理 tool_choice
    if (forwardBody.tool_choice && typeof forwardBody.tool_choice === 'object') {
      if (!forwardBody.tool_choice.thought_signature) {
        forwardBody.tool_choice.thought_signature = '';
      }
    }
  }

  const axiosConfig: any = {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000, // 2 分钟超时
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

/**
 * 转发到 Anthropic Claude API
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

  const axiosConfig: any = {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  };

  if (body.stream) {
    axiosConfig.responseType = 'stream';
    axiosConfig.maxContentLength = Infinity;
    axiosConfig.maxBodyLength = Infinity;
  } else {
    axiosConfig.responseType = 'json';
  }

  const response = await axios.post(url, anthropicBody, axiosConfig);

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

  return { success: true, response: response.data };
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

  // 转换消息格式：OpenAI -> Google
  const contents = body.messages.map(m => {
    // 正确处理多模态消息
    let parts: any[];
    if (typeof m.content === 'string') {
      parts = [{ text: m.content }];
    } else if (Array.isArray(m.content)) {
      // 转换OpenAI的多模态格式到Google Gemini格式
      parts = m.content.map((item: any) => {
        if (item.type === 'text') {
          return { text: item.text };
        } else if (item.type === 'image_url') {
          // Google Gemini支持inline_data格式的图片
          const imageUrl = item.image_url?.url || '';
          // 检查是否是base64图片
          if (imageUrl.startsWith('data:')) {
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              return {
                inlineData: {
                  mimeType: matches[1],
                  data: matches[2],
                },
              };
            }
          }
          // URL图片需要先下载，这里暂时忽略
          return { text: `[Image: ${imageUrl}]` };
        }
        return { text: JSON.stringify(item) };
      });
    } else {
      parts = [{ text: JSON.stringify(m.content) }];
    }
    
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });

  const googleBody = {
    contents,
    generationConfig: {
      temperature: body.temperature,
      topP: body.top_p,
      maxOutputTokens: body.max_tokens,
    },
  };

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