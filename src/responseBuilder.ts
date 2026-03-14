import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, ModelsResponse } from './types.js';
import { calculateTokens } from './billing.js';

// 构建非流式响应
export function buildResponse(content: string, model: string, requestId?: string, promptContent?: string): ChatCompletionResponse {
  const promptTokens = promptContent ? calculateTokens(promptContent, model) : 0;
  const completionTokens = calculateTokens(content, model);

  return {
    id: requestId || `chatcmpl-${uuidv4().replace(/-/g, '')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

// 构建流式响应块
export function buildStreamChunk(
  requestId: string,
  model: string,
  content: string,
  isFirst: boolean = false,
  isLast: boolean = false
): string {
  const chunk: ChatCompletionChunk = {
    id: requestId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: isFirst ? { role: 'assistant', content } : { content },
        finish_reason: isLast ? 'stop' : null,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

// 构建流式结束块
export function buildStreamDone(): string {
  return 'data: [DONE]\n\n';
}

// 获取模型列表
export function getModelsResponse(): ModelsResponse {
  const models = [
    'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-4-32k',
    'gpt-3.5-turbo', 'gpt-3.5-turbo-16k',
    'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
    'deepseek-chat', 'deepseek-coder',
  ];

  return {
    object: 'list',
    data: models.map((id) => ({
      id,
      object: 'model' as const,
      created: 1700000000,
      owned_by: 'openai',
    })),
  };
}

// 生成请求 ID
export function generateRequestId(): string {
  return `chatcmpl-${uuidv4().replace(/-/g, '')}`;
}
