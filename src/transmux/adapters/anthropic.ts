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

// ==================== 入口：Anthropic body -> IR ====================

function anthropicContentToParts(content: any): IRMessage['parts'] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : undefined;
  }
  if (!Array.isArray(content)) return undefined;
  const parts: IRMessage['parts'] = [];
  for (const item of content) {
    if (!isPlainObject(item)) continue;
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push({ type: 'text', text: item.text });
    } else if (item.type === 'image' && item.source) {
      const source = item.source;
      if (source.type === 'base64' && typeof source.data === 'string') {
        parts.push({ type: 'image', data: source.data, media_type: source.media_type });
      } else if (source.type === 'url' && typeof source.url === 'string') {
        parts.push({ type: 'image', url: source.url, media_type: source.media_type });
      }
    } else if (item.type === 'tool_use' && item.name) {
      parts.push({
        type: 'tool-call',
        id: typeof item.id === 'string' ? item.id : undefined,
        name: item.name,
        arguments: JSON.stringify(item.input ?? {}),
      });
    } else if (item.type === 'tool_result') {
      const callId = typeof item.tool_use_id === 'string' ? item.tool_use_id : undefined;
      let result = item.content;
      if (Array.isArray(result)) {
        result = result
          .map((c: any) => (c?.type === 'text' ? c.text ?? '' : typeof c === 'string' ? c : JSON.stringify(c)))
          .join('\n');
      }
      parts.push({ type: 'tool-result', tool_call_id: callId, content: String(result ?? '') });
    }
  }
  return parts && parts.length > 0 ? parts : undefined;
}

function parseAnthropicRequest(
  body: any,
  ctx: { requestedModel: string; forwardModel: string; stream: boolean }
): IRRequest {
  const messages: IRMessage[] = [];

  if (body?.system) {
    const systemContent = typeof body.system === 'string'
      ? body.system
      : Array.isArray(body.system)
        ? body.system.map((s: any) => s?.text ?? '').join('\n')
        : '';
    messages.push({ role: 'system', content: systemContent });
  }

  for (const m of body?.messages ?? []) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    if (typeof m?.content === 'string') {
      messages.push({ role, content: m.content });
      continue;
    }
    const parts = anthropicContentToParts(m?.content);
    messages.push({
      role,
      ...(parts ? { parts } : { content: '' }),
    });
  }

  const tools = Array.isArray(body?.tools)
    ? body.tools.map((t: any) => ({
        type: 'function' as const,
        function: {
          name: t?.name ?? '',
          ...(t?.description ? { description: t.description } : {}),
          ...(t?.input_schema ? { parameters: t.input_schema } : {}),
        },
      }))
    : undefined;

  const params: IRRequest['params'] = {};
  if (body?.temperature !== undefined) params.temperature = body.temperature;
  if (body?.top_p !== undefined) params.top_p = body.top_p;
  if (body?.max_tokens !== undefined) params.max_tokens = body.max_tokens;
  if (body?.stop_sequences !== undefined) params.stop = body.stop_sequences;
  if (body?.thinking !== undefined) {
    params.thinking = {
      type: body.thinking.type,
      budget_tokens: body.thinking.budget_tokens,
    };
  }

  return {
    model: ctx.requestedModel,
    forwardModel: ctx.forwardModel,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(body?.tool_choice ? { tool_choice: anthropicToolChoiceToIR(body.tool_choice) } : {}),
    params,
    stream: ctx.stream,
  };
}

function anthropicToolChoiceToIR(tc: any): Exclude<IRRequest['tool_choice'], undefined> {
  if (typeof tc === 'string') {
    return tc === 'any' ? 'required' : (tc as 'auto' | 'none');
  }
  if (isPlainObject(tc)) {
    if (tc.type === 'auto') return 'auto';
    if (tc.type === 'any') return 'required';
    if (tc.type === 'none') return 'none';
    if (tc.type === 'tool' && tc.name) {
      return { type: 'function', function: { name: tc.name } };
    }
  }
  return 'auto';
}

// ==================== 上游：IR -> Anthropic body ====================

function toAnthropicMessages(ir: IRRequest): any[] {
  const messages: any[] = [];
  for (const msg of ir.messages) {
    if (msg.role === 'system') continue; // system 单独处理
    const parts = msg.parts;
    if (msg.role === 'tool') {
      const tr = parts?.find(p => p.type === 'tool-result') as any;
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: tr?.tool_call_id ?? '',
            content: tr?.content ?? msg.content ?? '',
          },
        ],
      });
      continue;
    }
    if (parts && parts.some(p => p.type === 'tool-call')) {
      const content = parts
        .filter(p => p.type !== 'tool-call')
        .map(p => p.type === 'text' ? { type: 'text', text: p.text } : null)
        .filter(Boolean);
      const toolUses = parts
        .filter((p): p is { type: 'tool-call'; id?: string; name: string; arguments: string } => p.type === 'tool-call')
        .map((p) => ({
          type: 'tool_use',
          id: p.id,
          name: p.name,
          input: safeJsonParse(p.arguments, {}),
        }));
      messages.push({ role: 'assistant', content: [...(content as any[]), ...toolUses] });
      continue;
    }
    if (parts && parts.some(p => p.type === 'image')) {
      const content: any[] = [];
      for (const p of parts) {
        if (p.type === 'text') content.push({ type: 'text', text: p.text });
        if (p.type === 'image') {
          if (p.url) {
            content.push({
              type: 'image',
              source: { type: 'url', url: p.url, media_type: p.media_type },
            });
          } else if (p.data) {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: p.media_type ?? 'image/png', data: p.data },
            });
          }
        }
      }
      messages.push({ role: 'user', content });
      continue;
    }
    if (parts && parts.length > 0) {
      // 纯文本 parts 合并为 content
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: parts.map(p => p.type === 'text' ? p.text : '').join(''),
      });
      continue;
    }
    messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content ?? '' });
  }
  return messages;
}

function safeJsonParse(s: string, fallback: unknown): unknown {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function toAnthropicRequest(ir: IRRequest): any {
  const systemContent = ir.messages
    .filter(m => m.role === 'system')
    .map(m => m.content ?? '')
    .join('\n');

  const body: any = {
    model: ir.forwardModel,
    max_tokens: ir.params.max_tokens ?? 4096,
    messages: toAnthropicMessages(ir),
    ...(ir.stream ? { stream: true } : {}),
  };
  if (systemContent) body.system = systemContent;
  if (ir.tools && ir.tools.length > 0) {
    body.tools = ir.tools.map(t => ({
      name: t.function.name,
      ...(t.function.description ? { description: t.function.description } : {}),
      input_schema: t.function.parameters ?? { type: 'object', properties: {} },
    }));
  }
  if (ir.tool_choice) body.tool_choice = toAnthropicToolChoice(ir.tool_choice);
  if (ir.params.temperature !== undefined) body.temperature = ir.params.temperature;
  if (ir.params.top_p !== undefined) body.top_p = ir.params.top_p;
  if (ir.params.stop !== undefined) body.stop_sequences = ir.params.stop;
  if (ir.params.thinking) {
    body.thinking = {
      type: ir.params.thinking.type ?? 'enabled',
      ...(ir.params.thinking.budget_tokens ? { budget_tokens: ir.params.thinking.budget_tokens } : {}),
    };
  }
  return body;
}

function toAnthropicToolChoice(tc: Exclude<IRRequest['tool_choice'], undefined>): any {
  if (tc === 'auto') return { type: 'auto' };
  if (tc === 'none') return { type: 'none' };
  if (tc === 'required') return { type: 'any' };
  if (typeof tc === 'object') return { type: 'tool', name: tc.function.name };
  return { type: 'auto' };
}

// ==================== 上游：Anthropic 非流式响应 -> IR ====================

function fromAnthropicResponse(body: any, ctx: AdapterContext): IRResponse {
  const contentBlocks = body?.content ?? [];
  const textParts: string[] = [];
  const toolCalls: IRResponse['tool_calls'] = [];
  for (const block of contentBlocks) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    } else if (block?.type === 'tool_use' && block.name) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }
  const usage = body?.usage;
  return {
    id: body?.id ?? `msg_${Date.now()}`,
    model: ctx.model,
    content: textParts.join(''),
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    finish_reason: body?.stop_reason === 'end_turn' || body?.stop_reason === 'stop_sequence'
      ? 'stop'
      : body?.stop_reason === 'max_tokens' ? 'length'
      : body?.stop_reason === 'tool_use' ? 'tool_calls'
      : body?.stop_reason ?? null,
    usage: usage
      ? {
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          cache_read_tokens: usage.cache_read_input_tokens ?? 0,
        }
      : undefined,
  };
}

// ==================== 上游：Anthropic 流式事件 -> IR ====================

function createAnthropicStreamState(): StreamState {
  return { contentBlockIndex: 0, toolArgs: {}, toolNames: {}, toolIds: {} };
}

function fromAnthropicStreamEvent(payload: any, state: StreamState, ctx: AdapterContext): IRStreamEvent[] {
  if (!payload || !payload.type) return [];
  const events: IRStreamEvent[] = [];
  switch (payload.type) {
    case 'message_start': {
      const msg = payload.message;
      events.push({ type: 'start', id: msg?.id ?? `msg_${Date.now()}`, model: ctx.model });
      if (msg?.usage) {
        events.push({
          type: 'usage',
          usage: {
            input_tokens: msg.usage.input_tokens ?? 0,
            output_tokens: 0,
            total_tokens: msg.usage.input_tokens ?? 0,
            cache_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
          },
        });
      }
      break;
    }
    case 'content_block_start': {
      const block = payload.content_block;
      state.contentBlockIndex = payload.index ?? 0;
      if (block?.type === 'thinking') {
        events.push({ type: 'reasoning', text: block.thinking ?? '' });
      } else if (block?.type === 'tool_use' && block.name) {
        state.toolNames[state.contentBlockIndex] = block.name;
        state.toolIds[state.contentBlockIndex] = block.id;
        events.push({
          type: 'tool-call',
          index: state.contentBlockIndex,
          id: block.id,
          name: block.name,
          arguments: '',
        });
      }
      break;
    }
    case 'content_block_delta': {
      const delta = payload.delta;
      if (delta?.type === 'text_delta') {
        events.push({ type: 'text', text: delta.text ?? '' });
      } else if (delta?.type === 'thinking_delta') {
        events.push({ type: 'reasoning', text: delta.thinking ?? '' });
      } else if (delta?.type === 'input_json_delta') {
        const index = payload.index ?? state.contentBlockIndex;
        state.toolArgs[index] = (state.toolArgs[index] ?? '') + (delta.partial_json ?? '');
        events.push({
          type: 'tool-call',
          index,
          name: state.toolNames[index],
          id: state.toolIds[index],
          arguments: delta.partial_json ?? '',
        });
      }
      break;
    }
    case 'message_delta': {
      const delta = payload.delta;
      const finish = delta?.stop_reason === 'end_turn' || delta?.stop_reason === 'stop_sequence'
        ? 'stop'
        : delta?.stop_reason === 'max_tokens' ? 'length'
        : delta?.stop_reason === 'tool_use' ? 'tool_calls'
        : delta?.stop_reason ?? null;
      if (finish) events.push({ type: 'done', finish_reason: finish });
      if (payload.usage) {
        events.push({
          type: 'usage',
          usage: {
            input_tokens: 0,
            output_tokens: payload.usage.output_tokens ?? 0,
            total_tokens: payload.usage.output_tokens ?? 0,
          },
          finish_reason: finish,
        });
      }
      break;
    }
    case 'message_stop': {
      // 若 message_delta 已给出 finish，则不重复；兜底 push done
      if (!state.toolArgs) break;
      break;
    }
    case 'error':
      events.push({
        type: 'error',
        message: payload.error?.message ?? 'Anthropic stream error',
        code: payload.error?.type,
      });
      break;
    default:
      break;
  }
  return events;
}

// ==================== 入口：IR -> Anthropic 响应 ====================

function serializeAnthropicResponse(ir: IRResponse, requestedModel: string): any {
  const content: any[] = [];
  if (ir.content) content.push({ type: 'text', text: ir.content });
  if (ir.tool_calls && ir.tool_calls.length > 0) {
    for (const tc of ir.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id ?? `toolu_${Date.now()}`,
        name: tc.name,
        input: safeJsonParse(tc.arguments, {}),
      });
    }
  }
  const stopReason = ir.finish_reason === 'stop' ? 'end_turn'
    : ir.finish_reason === 'length' ? 'max_tokens'
    : ir.finish_reason === 'tool_calls' ? 'tool_use'
    : 'end_turn';
  return {
    id: ir.id,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: ir.usage?.input_tokens ?? 0,
      output_tokens: ir.usage?.output_tokens ?? 0,
      ...(ir.usage?.cache_read_tokens ? { cache_read_input_tokens: ir.usage.cache_read_tokens } : {}),
    },
  };
}

function createAnthropicEntryState(): EntryStreamState {
  return { started: false, contentBlockStarted: false, contentBlockIndex: 0 };
}

/** 惰性发送 message_start（当上游未提供 start 事件时，首个内容事件前补发） */
function ensureAnthropicStart(
  requestedModel: string,
  state: EntryStreamState,
  out: string,
): string {
  if (state.started) return out;
  state.started = true;
  return `event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: requestedModel,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })}\n\n` + out;
}

function serializeAnthropicStreamEvent(
  evt: IRStreamEvent,
  requestedModel: string,
  state: EntryStreamState,
): string | null {
  let out = '';
  if (evt.type === 'start') {
    if (!state.started) {
      state.started = true;
      out += `event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: evt.id ?? `msg_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          model: requestedModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })}\n\n`;
    }
    return out;
  }
  if (evt.type === 'text') {
    out = ensureAnthropicStart(requestedModel, state, out);
    if (!state.contentBlockStarted) {
      state.contentBlockStarted = true;
      state.contentBlockIndex = 0;
      out += `event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })}\n\n`;
    }
    out += `event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: state.contentBlockIndex,
      delta: { type: 'text_delta', text: evt.text },
    })}\n\n`;
    return out;
  }
  if (evt.type === 'reasoning') {
    out = ensureAnthropicStart(requestedModel, state, out);
    out += `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: state.contentBlockIndex,
      content_block: { type: 'thinking', thinking: evt.text, signature: '' },
    })}\n\n`;
    out += `event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: state.contentBlockIndex,
      delta: { type: 'thinking_delta', thinking: evt.text },
    })}\n\n`;
    return out;
  }
  if (evt.type === 'tool-call') {
    const index = evt.index ?? 0;
    out = ensureAnthropicStart(requestedModel, state, out);
    if (evt.name) {
      out += `event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: evt.id ?? `toolu_${Date.now()}`, name: evt.name, input: {} },
      })}\n\n`;
    }
    if (evt.arguments) {
      out += `event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: evt.arguments },
      })}\n\n`;
    }
    return out;
  }
  if (evt.type === 'done' || evt.type === 'usage') {
    out = ensureAnthropicStart(requestedModel, state, out);
    if (state.contentBlockStarted) {
      out += `event: content_block_stop\ndata: ${JSON.stringify({
        type: 'content_block_stop',
        index: state.contentBlockIndex,
      })}\n\n`;
    }
    const stopReason = evt.finish_reason === 'stop' ? 'end_turn'
      : evt.finish_reason === 'length' ? 'max_tokens'
      : evt.finish_reason === 'tool_calls' ? 'tool_use'
      : 'end_turn';
    const usage = evt.type === 'usage' ? evt.usage : undefined;
    out += `event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: {
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        ...(usage?.cache_read_tokens ? { cache_read_input_tokens: usage.cache_read_tokens } : {}),
      },
    })}\n\n`;
    out += `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
    return out;
  }
  if (evt.type === 'error') {
    return `event: error\ndata: ${JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: evt.message },
    })}\n\n`;
  }
  return null;
}

function anthropicStreamDone(): string {
  return '';
}

export const anthropicAdapter: TransmuxAdapter = {
  protocol: 'anthropic',
  variants: ['messages'],

  parseRequest: parseAnthropicRequest,
  toRequest: toAnthropicRequest,
  fromResponse: fromAnthropicResponse,
  createStreamState: createAnthropicStreamState,
  fromStreamEvent: fromAnthropicStreamEvent,
  serializeResponse: serializeAnthropicResponse,
  createEntryState: createAnthropicEntryState,
  serializeStreamEvent: serializeAnthropicStreamEvent,
  streamDone: anthropicStreamDone,
};
