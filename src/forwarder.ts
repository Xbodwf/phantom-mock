import axios from 'axios';
import type { ChatCompletionRequest, Model } from './types.js';
import type { Response } from 'express';
import { generateRequestId } from './responseBuilder.js';

/**
 * 获取转发时使用的模型名称
 */
function getForwardModelName(model: Model, requestedModel: string): string {
  return model.forwardModelName || requestedModel;
}

/**
 * 转发请求到真实的 API
 */
export async function forwardChatRequest(
  model: Model,
  body: ChatCompletionRequest
): Promise<{ success: true; response: any } | { success: false; error: string }> {
  if (!model.api_base_url || !model.api_key) {
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Forwarder] Error forwarding to ${apiType}:`, errorMessage);
    return { success: false, error: errorMessage };
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
  if (!model.api_base_url || !model.api_key) {
    throw new Error('Model not configured for forwarding');
  }

  // 生成统一的请求 ID
  const requestId = generateRequestId();

  // 设置流式响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let url = model.api_base_url;
  if (!url.includes('/chat/completions')) {
    url = `${url}/chat/completions`;
  }

  // 使用转发模型名称
  const forwardModel = getForwardModelName(model, body.model);
  const forwardBody = { ...body, model: forwardModel };

  const response = await axios.post(url, forwardBody, {
    headers: {
      'Authorization': `Bearer ${model.api_key}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
    responseType: 'stream',
  });

  // 处理流数据，统一 id 格式
  let firstChunk = true;
  response.data.on('data', (chunk: Buffer) => {
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
    res.end();
  });

  response.data.on('error', (err: Error) => {
    console.error('[Forwarder] Stream error:', err.message);
    res.end();
  });
}

/**
 * 转发到 OpenAI 兼容的 API
 */
async function forwardToOpenAI(
  model: Model,
  body: ChatCompletionRequest
): Promise<{ success: true; response: any }> {
  // 智能处理 URL：如果 api_base_url 已经包含完整路径，直接使用
  let url = model.api_base_url!;
  if (!url.includes('/chat/completions')) {
    url = `${url}/chat/completions`;
  }

  // 使用转发模型名称
  const forwardModel = getForwardModelName(model, body.model);
  const forwardBody = { ...body, model: forwardModel };

  const response = await axios.post(url, forwardBody, {
    headers: {
      'Authorization': `Bearer ${model.api_key}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000, // 2 分钟超时
    responseType: body.stream ? 'stream' : 'json',
  });

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
  const url = `${model.api_base_url}/v1/messages`;

  // 使用转发模型名称
  const forwardModel = getForwardModelName(model, body.model);

  // 转换消息格式：OpenAI -> Anthropic
  const systemMessages = body.messages.filter(m => m.role === 'system');
  const nonSystemMessages = body.messages.filter(m => m.role !== 'system');

  const anthropicBody = {
    model: forwardModel,
    messages: nonSystemMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    max_tokens: body.max_tokens || 4096,
    temperature: body.temperature,
    top_p: body.top_p,
    stream: body.stream,
    system: systemMessages.length > 0 ? systemMessages[0].content : undefined,
  };

  const response = await axios.post(url, anthropicBody, {
    headers: {
      'x-api-key': model.api_key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    timeout: 120000,
    responseType: body.stream ? 'stream' : 'json',
  });

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
  // 使用转发模型名称
  const forwardModel = getForwardModelName(model, body.model);
  const url = `${model.api_base_url}/v1beta/models/${forwardModel}:generateContent?key=${model.api_key}`;

  // 转换消息格式：OpenAI -> Google
  const contents = body.messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

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