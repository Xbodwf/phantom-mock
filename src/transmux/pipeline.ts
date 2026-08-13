import axios from 'axios';
import type { Response } from 'express';
import type {
  AdapterContext,
  EntryStreamState,
  IRRequest,
  IRResponse,
  IRStreamEvent,
  StreamState,
  TransmuxAdapter,
  TransmuxProtocol,
} from './types.js';
import { getAdapter } from './registry.js';
import { openaiAdapter } from './adapters/openai.js';
import { anthropicAdapter } from './adapters/anthropic.js';
import { googleAdapter } from './adapters/google.js';

import { registerAdapter } from './registry.js';

registerAdapter(openaiAdapter);
registerAdapter(anthropicAdapter);
registerAdapter(googleAdapter);

export interface TransmuxTarget {
  protocol: TransmuxProtocol;
  variant: string;
  /** 上游请求体构造后实际要请求的完整 URL */
  url: string;
  /** 请求头（含认证） */
  headers: Record<string, string>;
  /** 上游模型名 */
  model: string;
}

export interface TransmuxRequest {
  /** 客户端请求的原始 body */
  body: any;
  /** 入口协议 */
  entryProtocol: TransmuxProtocol;
  /** 入口变体 */
  entryVariant: string;
  /** 客户端请求的模型名（响应回显用） */
  requestedModel: string;
  /** 是否流式 */
  stream: boolean;
}

export interface TransmuxCallResult {
  success: boolean;
  /** 非流式：序列化后的入口协议响应 body */
  response?: any;
  /** 错误（OpenAI 格式错误对象） */
  error?: any;
}

const defaultTarget: TransmuxTarget = {
  protocol: 'openai',
  variant: 'chat-completions',
  url: '',
  headers: {},
  model: '',
};

/**
 * 核心管线：
 *   parseRequest(入口 body -> IR)
 *   -> toRequest(IR -> 上游 body)
 *   -> 上游 HTTP 调用
 *   -> fromResponse/fromStreamEvent(上游 -> IR)
 *   -> serializeResponse/serializeStreamEvent(IR -> 入口协议)
 */
export async function transmuxCall(
  target: TransmuxTarget,
  request: TransmuxRequest,
  timeoutMs = 120000,
): Promise<TransmuxCallResult> {
  const adapter = getAdapter(target.protocol);

  try {
    // 1. 入口协议解析 -> IR
    const entryAdapter = getAdapter(request.entryProtocol);
    const ir: IRRequest = entryAdapter.parseRequest(request.body, {
      requestedModel: request.requestedModel,
      forwardModel: target.model,
      stream: request.stream,
      variant: request.entryVariant,
    });

    if (request.stream) {
      return { success: true, response: null }; // 流式由 streamTransmux 处理
    }

    // 2. IR -> 上游 body
    const upstreamBody = adapter.toRequest(ir, { variant: target.variant });

    // 3. 调用上游
    const ctx: AdapterContext = {
      protocol: target.protocol,
      variant: target.variant,
      model: target.model,
      stream: false,
    };

    const axiosConfig: any = {
      headers: target.headers,
      timeout: timeoutMs,
      responseType: 'json',
    };

    const response = await axios.post(target.url, upstreamBody, axiosConfig);

    // 4. 上游响应 -> IR
    const irResponse = adapter.fromResponse(response.data, ctx);

    // 5. IR -> 入口协议序列化
    const serialized = entryAdapter.serializeResponse(irResponse, request.requestedModel, request.entryVariant);
    return { success: true, response: serialized };
  } catch (error: any) {
    const message = error?.response?.data?.error?.message
      || error?.response?.data?.error
      || error?.message
      || 'Unknown error';
    return {
      success: false,
      error: {
        error: {
          message: typeof message === 'string' ? message : JSON.stringify(message),
          type: 'api_error',
          code: 'transmux_failed',
        },
      },
    };
  }
}

/**
 * 流式管线：上游 SSE -> IR -> 入口协议 SSE
 */
export async function transmuxStream(
  target: TransmuxTarget,
  request: TransmuxRequest,
  res: Response,
  onStreamData?: (info: { content: string; reasoningContent?: string | null }) => void,
): Promise<void> {
  const adapter = getAdapter(target.protocol);
  const entryAdapter = getAdapter(request.entryProtocol);

  // 入口协议解析 -> IR
  const ir: IRRequest = entryAdapter.parseRequest(request.body, {
    requestedModel: request.requestedModel,
    forwardModel: target.model,
    stream: true,
    variant: request.entryVariant,
  });

  // IR -> 上游 body
  const upstreamBody = adapter.toRequest(ir, { variant: target.variant });

  const ctx: AdapterContext = {
    protocol: target.protocol,
    variant: target.variant,
    model: target.model,
    stream: true,
  };

  const response = await axios.post(target.url, upstreamBody, {
    headers: target.headers,
    timeout: 120000,
    responseType: 'stream',
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let clientClosed = false;
  res.on('close', () => {
    clientClosed = true;
    if (response.data && typeof response.data.destroy === 'function') {
      response.data.destroy();
    }
  });

  const streamState: StreamState = adapter.createStreamState();
  const entryState: EntryStreamState = entryAdapter.createEntryState();

  let buffer = '';
  let emittedStart = false;
  let sawDone = false;
  let reasoningBuf = '';

  const emit = (events: IRStreamEvent[]) => {
    if (clientClosed) return;
    for (const evt of events) {
      if (evt.type === 'start' && !emittedStart) {
        emittedStart = true;
      }
      if (evt.type === 'done' || evt.type === 'usage') {
        sawDone = true;
      }
      const sse = entryAdapter.serializeStreamEvent(evt, request.requestedModel, entryState, request.entryVariant);
      if (sse) res.write(sse);
      if (evt.type === 'text') onStreamData?.({ content: evt.text });
      if (evt.type === 'reasoning') {
        reasoningBuf += evt.text;
        onStreamData?.({ content: '', reasoningContent: evt.text });
      }
    }
  };

  // 处理上游 SSE 数据
  const handleData = (chunk: Buffer) => {
    if (clientClosed) return;
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === 'data: [DONE]') continue;
      // 兼容 SSE: data: {...} 或纯 JSON 行
      let payloadStr = trimmed;
      if (payloadStr.startsWith('data:')) {
        payloadStr = payloadStr.slice(5).trim();
      }
      // 忽略非 data 行（如 event: / id: / ping）
      if (!payloadStr.startsWith('{') && !payloadStr.startsWith('[')) continue;
      try {
        const payload = JSON.parse(payloadStr);
        const events = adapter.fromStreamEvent(payload, streamState, ctx);
        emit(events);
      } catch {
        // 不完整的 JSON，留给下一个 chunk
      }
    }
  };

  response.data.on('data', handleData);

  response.data.on('end', () => {
    if (clientClosed) return;
    // 仅在未收到 done/usage 事件时补发完成事件（避免重复）
    if (!sawDone) {
      const doneSse = entryAdapter.serializeStreamEvent(
        { type: 'done', finish_reason: 'stop' },
        request.requestedModel,
        entryState,
        request.entryVariant,
      );
      if (doneSse) res.write(doneSse);
    }
    const done = entryAdapter.streamDone();
    if (done) res.write(done);
    res.end();
  });

  response.data.on('error', (err: Error) => {
    console.error('[Transmux] stream error:', err.message);
    if (!clientClosed) {
      res.end();
    }
  });
}

export { defaultTarget };
export type { TransmuxProtocol };
