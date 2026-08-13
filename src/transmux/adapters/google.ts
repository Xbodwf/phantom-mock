import type {
  AdapterContext,
  EntryStreamState,
  IRMessage,
  IRRequest,
  IRResponse,
  IRStreamEvent,
  StreamState,
  TransmuxAdapter,
} from '../types.js';

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ==================== 入口：Gemini body -> IR ====================

function parseGoogleRequest(
  body: any,
  ctx: { requestedModel: string; forwardModel: string; stream: boolean }
): IRRequest {
  const messages: IRMessage[] = [];

  if (body?.systemInstruction) {
    const text = extractPartsText(body.systemInstruction.parts);
    if (text) messages.push({ role: 'system', content: text });
  }

  for (const item of body?.contents ?? []) {
    const role: IRMessage['role'] = item.role === 'model' ? 'assistant' : item.role === 'system' ? 'system' : 'user';
    const parts: IRMessage['parts'] = [];
    for (const part of item.parts ?? []) {
      if (!isPlainObject(part)) continue;
      if (typeof part.text === 'string' && part.text) {
        parts.push({ type: 'text', text: part.text });
      } else if (part.inlineData && part.inlineData.data) {
        parts.push({
          type: 'image',
          data: part.inlineData.data,
          media_type: part.inlineData.mimeType,
        });
      } else if (part.inline_data && part.inline_data.data) {
        parts.push({
          type: 'image',
          data: part.inline_data.data,
          media_type: part.inline_data.mime_type,
        });
      } else if (part.fileData && part.fileData.fileUri) {
        parts.push({ type: 'image', url: part.fileData.fileUri });
      } else if (part.functionCall && part.functionCall.name) {
        parts.push({
          type: 'tool-call',
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        });
      } else if (part.functionResponse && part.functionResponse.name) {
        parts.push({
          type: 'tool-result',
          name: part.functionResponse.name,
          content: JSON.stringify(part.functionResponse.response ?? ''),
        });
      }
    }
    if (parts.length === 0) continue;
    // 纯文本 parts 归一化为 content
    if (parts.every(p => p.type === 'text')) {
      messages.push({ role, content: parts.map(p => (p as any).text).join('\n') });
    } else {
      messages.push({ role, parts });
    }
  }

  const tools: IRRequest['tools'] = [];
  for (const tool of body?.tools ?? []) {
    for (const fn of tool?.functionDeclarations ?? []) {
      tools.push({
        type: 'function',
        function: {
          name: fn.name ?? '',
          ...(fn.description ? { description: fn.description } : {}),
          ...(fn.parameters ? { parameters: fn.parameters } : {}),
          ...(typeof fn.thought_signature === 'string' ? { thought_signature: fn.thought_signature } : {}),
        },
      });
    }
  }

  const gc = body?.generationConfig ?? {};
  const params: IRRequest['params'] = {};
  if (gc.temperature !== undefined) params.temperature = gc.temperature;
  if (gc.topP !== undefined) params.top_p = gc.topP;
  if (gc.maxOutputTokens !== undefined) params.max_tokens = gc.maxOutputTokens;
  if (gc.stopSequences !== undefined) params.stop = gc.stopSequences;
  if (gc.responseMimeType !== undefined) {
    params.response_format = { type: gc.responseMimeType === 'application/json' ? 'json_object' : 'text' };
  }

  return {
    model: ctx.requestedModel,
    forwardModel: ctx.forwardModel,
    messages,
    ...(tools.length > 0 ? { tools } : {}),
    params,
    stream: ctx.stream,
  };
}

function extractPartsText(parts: any[]): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p: any) => p && typeof p.text === 'string')
    .map((p: any) => p.text)
    .join('\n');
}

// ==================== 上游：IR -> Gemini body ====================

function toGoogleRequest(ir: IRRequest): any {
  const systemMessages = ir.messages.filter(m => m.role === 'system');
  const contents = ir.messages
    .filter(m => m.role !== 'system')
    .map(m => {
      const role = m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'function' : 'user';
      const parts: any[] = [];
      const msgParts = m.parts ?? (m.content ? [{ type: 'text', text: m.content }] : []);
      for (const p of msgParts) {
        if (p.type === 'text') {
          parts.push({ text: p.text });
        } else if (p.type === 'image') {
          if (p.data) {
            parts.push({ inlineData: { mimeType: p.media_type ?? 'image/png', data: p.data } });
          } else if (p.url) {
            // Gemini 原生不支持任意 http(s) 图片 URL；用 fileData 表达，或降级文本
            if (p.url.startsWith('gs://') || p.url.startsWith('http')) {
              parts.push({ fileData: { mimeType: p.media_type ?? 'image/png', fileUri: p.url } });
            } else {
              parts.push({ text: `[Image: ${p.url}]` });
            }
          }
        } else if (p.type === 'tool-call') {
          parts.push({ functionCall: { name: p.name, args: safeJsonParse(p.arguments, {}) } });
        } else if (p.type === 'tool-result') {
          parts.push({ functionResponse: { name: p.name ?? '', response: safeJsonParse(p.content, {}) } });
        }
      }
      return { role, parts };
    });

  const body: any = {};
  if (systemMessages.length > 0) {
    body.systemInstruction = {
      parts: systemMessages.map(m => ({ text: m.content ?? '' })),
    };
  }
  body.contents = contents;

  const gc: Record<string, unknown> = {};
  if (ir.params.temperature !== undefined) gc.temperature = ir.params.temperature;
  if (ir.params.top_p !== undefined) gc.topP = ir.params.top_p;
  if (ir.params.max_tokens !== undefined) gc.maxOutputTokens = ir.params.max_tokens;
  if (ir.params.stop !== undefined) gc.stopSequences = ir.params.stop;
  if (ir.params.response_format !== undefined) {
    gc.responseMimeType = (ir.params.response_format as any)?.type === 'json_object' ? 'application/json' : 'text/plain';
  }
  if (Object.keys(gc).length > 0) body.generationConfig = gc;

  if (ir.tools && ir.tools.length > 0) {
    body.tools = [{
      functionDeclarations: ir.tools.map(t => {
        const fd: Record<string, unknown> = {
          name: t.function.name,
          ...(t.function.description ? { description: t.function.description } : {}),
          ...(t.function.parameters ? { parameters: t.function.parameters } : {}),
        };
        if (t.function.thought_signature) fd.thought_signature = t.function.thought_signature;
        return fd;
      }),
    }];
  }

  return body;
}

function safeJsonParse(s: string, fallback: unknown): unknown {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// ==================== 上游：Gemini 非流式响应 -> IR ====================

function fromGoogleResponse(body: any, ctx: AdapterContext): IRResponse {
  const candidate = body?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  let content = '';
  const toolCalls: IRResponse['tool_calls'] = [];
  for (const part of parts) {
    if (part?.text) {
      content += part.text;
    } else if (part?.functionCall && part.functionCall.name) {
      toolCalls.push({
        id: part.functionCall.id ?? `call_${Date.now()}`,
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args ?? {}),
        extra_content: typeof part.functionCall.thought_signature === 'string' ? part.functionCall.thought_signature : undefined,
      });
    }
  }
  const usage = body?.usageMetadata;
  return {
    id: `chatcmpl-${Date.now()}`,
    model: ctx.model,
    content,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    finish_reason: candidate?.finishReason === 'STOP' ? 'stop'
      : candidate?.finishReason === 'MAX_TOKENS' ? 'length'
      : candidate?.finishReason ?? null,
    usage: usage
      ? {
          input_tokens: usage.promptTokenCount ?? 0,
          output_tokens: usage.candidatesTokenCount ?? 0,
          total_tokens: usage.totalTokenCount ?? 0,
        }
      : undefined,
  };
}

// ==================== 上游：Gemini 流式 -> IR ====================

function createGoogleStreamState(): StreamState {
  return { contentBlockIndex: 0, toolArgs: {}, toolNames: {}, toolIds: {} };
}

function fromGoogleStreamEvent(payload: any, state: StreamState, ctx: AdapterContext): IRStreamEvent[] {
  if (!payload) return [];
  const events: IRStreamEvent[] = [];
  const candidates = payload.candidates ?? [];
  const parts = candidates[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part?.text) {
      events.push({ type: 'text', text: part.text });
    } else if (part?.functionCall && part.functionCall.name) {
      const fc = part.functionCall;
      events.push({
        type: 'tool-call',
        index: 0,
        id: fc.id ?? `call_${Date.now()}`,
        name: fc.name,
        arguments: JSON.stringify(fc.args ?? {}),
      });
    }
  }
  const finishRaw = candidates[0]?.finishReason ?? payload.finishReason;
  if (finishRaw) {
    const finish = finishRaw === 'STOP' ? 'stop'
      : finishRaw === 'MAX_TOKENS' ? 'length'
      : finishRaw;
    events.push({ type: 'done', finish_reason: finish });
  }
  if (payload.usageMetadata) {
    const usage = payload.usageMetadata;
    events.push({
      type: 'usage',
      usage: {
        input_tokens: usage.promptTokenCount ?? 0,
        output_tokens: usage.candidatesTokenCount ?? 0,
        total_tokens: usage.totalTokenCount ?? 0,
      },
      finish_reason: candidates[0]?.finishReason ?? null,
    });
  }
  return events;
}

// ==================== 入口：IR -> Gemini 响应 ====================

function serializeGoogleResponse(ir: IRResponse, requestedModel: string): any {
  const parts: any[] = [];
  if (ir.content) parts.push({ text: ir.content });
  if (ir.tool_calls && ir.tool_calls.length > 0) {
    for (const tc of ir.tool_calls) {
      parts.push({ functionCall: { name: tc.name, args: safeJsonParse(tc.arguments, {}) } });
    }
  }
  return {
    candidates: [{
      content: { parts, role: 'model' },
      finishReason: ir.finish_reason === 'stop' ? 'STOP'
        : ir.finish_reason === 'length' ? 'MAX_TOKENS'
        : ir.finish_reason === 'tool_calls' ? 'STOP'
        : 'STOP',
      safetyRatings: [],
    }],
    modelVersion: requestedModel,
    usageMetadata: ir.usage
      ? {
          promptTokenCount: ir.usage.input_tokens,
          candidatesTokenCount: ir.usage.output_tokens,
          totalTokenCount: ir.usage.total_tokens,
        }
      : undefined,
  };
}

function createGoogleEntryState(): EntryStreamState {
  return { started: false, contentBlockStarted: false, contentBlockIndex: 0 };
}

function serializeGoogleStreamEvent(
  evt: IRStreamEvent,
  requestedModel: string,
  state: EntryStreamState,
): string | null {
  if (evt.type === 'error') {
    return `data: ${JSON.stringify({
      candidates: [],
      error: { message: evt.message, code: evt.code ?? 'transmux_error' },
    })}\n\n`;
  }
  const parts: any[] = [];
  let finishReason: string | null = null;
  if (evt.type === 'text') {
    parts.push({ text: evt.text });
  } else if (evt.type === 'tool-call') {
    parts.push({
      functionCall: {
        name: evt.name,
        args: evt.arguments ? safeJsonParse(evt.arguments, {}) : {},
      },
    });
  } else if (evt.type === 'reasoning') {
    parts.push({ text: `[thinking: ${evt.text}]` });
  } else if (evt.type === 'done') {
    finishReason = evt.finish_reason === 'stop' ? 'STOP'
      : evt.finish_reason === 'length' ? 'MAX_TOKENS'
      : (evt.finish_reason ?? null);
  } else if (evt.type === 'usage') {
    finishReason = evt.finish_reason === 'stop' ? 'STOP'
      : evt.finish_reason === 'length' ? 'MAX_TOKENS'
      : (evt.finish_reason ?? null);
  }
  if (parts.length === 0 && !finishReason) return null;
  const payload: any = {
    candidates: [{
      content: { parts, role: 'model' },
      ...(finishReason ? { finishReason } : {}),
    }],
  };
  if (evt.type === 'usage' && evt.usage) {
    payload.usageMetadata = {
      promptTokenCount: evt.usage.input_tokens,
      candidatesTokenCount: evt.usage.output_tokens,
      totalTokenCount: evt.usage.total_tokens,
    };
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function googleStreamDone(): string {
  return '';
}

export const googleAdapter: TransmuxAdapter = {
  protocol: 'google',
  variants: ['generate-content', 'stream-generate-content'],

  parseRequest: parseGoogleRequest,
  toRequest: toGoogleRequest,
  fromResponse: fromGoogleResponse,
  createStreamState: createGoogleStreamState,
  fromStreamEvent: fromGoogleStreamEvent,
  serializeResponse: serializeGoogleResponse,
  createEntryState: createGoogleEntryState,
  serializeStreamEvent: serializeGoogleStreamEvent,
  streamDone: googleStreamDone,

  // ---------- 嵌入（Gemini embedContent） ----------
  parseEmbeddingRequest(body: any, ctx: { requestedModel: string; forwardModel: string }): any {
    const inputs = Array.isArray(body?.input) ? body.input : [body?.input ?? ''];
    return {
      model: ctx.requestedModel,
      forwardModel: ctx.forwardModel,
      input: inputs,
      encoding_format: body?.encoding_format,
    };
  },
  toEmbeddingRequest(ir: any): any {
    const inputs = Array.isArray(ir.input) ? ir.input : [ir.input];
    const content = { parts: [{ text: String(inputs[0] ?? '') }] };
    return { model: `models/${ir.forwardModel}`, content };
  },
  fromEmbeddingResponse(body: any, requestedModel: string): any {
    const values = body?.embedding?.values ?? body?.values ?? [];
    return {
      object: 'list',
      data: [{ object: 'embedding', embedding: values, index: 0 }],
      model: requestedModel,
      usage: { prompt_tokens: 0, total_tokens: 0 },
    };
  },
  serializeEmbeddingResponse(ir: any, _requestedModel: string): any {
    return ir;
  },
};
