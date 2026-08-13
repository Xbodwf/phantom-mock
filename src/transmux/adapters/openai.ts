import type {
  AdapterContext,
  EntryStreamState,
  IRMessage,
  IRMessagePart,
  IRRequest,
  IRResponse,
  IRStreamEvent,
  StreamState,
  TransmuxAdapter,
} from '../types.js';

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseContent(content: string | any[]): IRMessagePart[] | undefined {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : undefined;
  }
  if (!Array.isArray(content)) return undefined;
  const parts: IRMessagePart[] = [];
  for (const item of content) {
    if (!isPlainObject(item)) continue;
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push({ type: 'text', text: item.text });
    } else if (item.type === 'image_url' && item.image_url) {
      const url = typeof item.image_url === 'string' ? item.image_url : item.image_url.url;
      parts.push({ type: 'image', url: typeof url === 'string' ? url : undefined });
    } else if (item.type === 'input_image' && item.image) {
      const url = typeof item.image === 'string' ? item.image : item.image.url;
      parts.push({ type: 'image', url: typeof url === 'string' ? url : undefined });
    } else if (item.type === 'function_call' && item.name) {
      parts.push({
        type: 'tool-call',
        id: typeof item.id === 'string' ? item.id : undefined,
        name: item.name,
        arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? '{}'),
      });
    } else if (item.type === 'function_call_output' || item.type === 'function_response') {
      const callId = typeof item.call_id === 'string' ? item.call_id : undefined;
      const contentVal = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '');
      parts.push({ type: 'tool-result', tool_call_id: callId, content: contentVal });
    }
  }
  return parts.length > 0 ? parts : undefined;
}

function toOpenAIMessages(ir: IRRequest): any[] {
  const messages: any[] = [];
  for (const msg of ir.messages) {
    if (msg.role === 'system') {
      messages.push({ role: 'system', content: msg.content ?? '' });
      continue;
    }
    if (msg.role === 'tool') {
      const parts = msg.parts ?? [];
      const toolResult = parts.find(p => p.type === 'tool-result') as any;
      messages.push({
        role: 'tool',
        tool_call_id: msg.parts?.[0]?.type === 'tool-result' ? msg.parts[0].tool_call_id : undefined,
        content: toolResult?.content ?? msg.content ?? '',
      });
      continue;
    }
    if (msg.role === 'assistant') {
      const parts = msg.parts ?? [];
      const toolCalls = parts
        .filter(p => p.type === 'tool-call')
        .map(p => ({
          id: p.id,
          type: 'function',
          function: { name: p.name, arguments: p.arguments },
        }));
      const text = parts
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join('');
      const hasToolCalls = toolCalls.length > 0;
      const hasText = text.length > 0;
      if (hasText && !hasToolCalls) {
        messages.push({ role: 'assistant', content: text });
      } else if (hasToolCalls && !hasText) {
        messages.push({ role: 'assistant', content: null, tool_calls: toolCalls });
      } else if (hasToolCalls && hasText) {
        messages.push({
          role: 'assistant',
          content: text,
          tool_calls: toolCalls.map(tc => ({ ...tc, function: { ...tc.function } })),
        });
      } else {
        messages.push({ role: 'assistant', content: '' });
      }
      continue;
    }
    // user
    const parts = msg.parts ?? [];
    const imageParts = parts.filter(p => p.type === 'image');
    const textParts = parts.filter(p => p.type === 'text');
    if (imageParts.length > 0) {
      const content: any[] = textParts.map(p => ({ type: 'text', text: p.text }));
      for (const img of imageParts) {
        if (img.url) {
          content.push({ type: 'image_url', image_url: { url: img.url } });
        } else if (img.data) {
          const prefix = img.media_type ? `data:${img.media_type};base64,` : 'data:image/png;base64,';
          content.push({ type: 'image_url', image_url: { url: `${prefix}${img.data}` } });
        }
      }
      messages.push({ role: 'user', content });
    } else if (parts.length > 0 && msg.content === undefined) {
      messages.push({ role: 'user', content: parts.map(p => p.type === 'text' ? p.text : '').join('') });
    } else {
      messages.push({ role: 'user', content: msg.content ?? '' });
    }
  }
  return messages;
}

function toOpenAIRequest(ir: IRRequest): any {
  const body: any = {
    model: ir.forwardModel,
    messages: toOpenAIMessages(ir),
    stream: ir.stream,
  };
  if (ir.tools && ir.tools.length > 0) {
    body.tools = ir.tools.map(t => ({
      type: 'function',
      function: {
        name: t.function.name,
        ...(t.function.description ? { description: t.function.description } : {}),
        parameters: t.function.parameters ?? { type: 'object', properties: {} },
        ...(t.function.thought_signature ? { thought_signature: t.function.thought_signature } : {}),
      },
    }));
  }
  if (ir.tool_choice) body.tool_choice = ir.tool_choice;
  const p = ir.params;
  if (p.temperature !== undefined) body.temperature = p.temperature;
  if (p.top_p !== undefined) body.top_p = p.top_p;
  if (p.max_tokens !== undefined) body.max_tokens = p.max_tokens;
  if (p.stop !== undefined && p.stop.length > 0) body.stop = p.stop.length === 1 ? p.stop[0] : p.stop;
  if (p.presence_penalty !== undefined) body.presence_penalty = p.presence_penalty;
  if (p.frequency_penalty !== undefined) body.frequency_penalty = p.frequency_penalty;
  if (p.seed !== undefined) body.seed = p.seed;
  if (p.response_format !== undefined) body.response_format = p.response_format;
  if (p.extra) {
    for (const [k, v] of Object.entries(p.extra)) {
      if (body[k] === undefined) body[k] = v;
    }
  }
  return body;
}

// ==================== 上游响应解析 ====================

function fromOpenAIResponse(body: any, ctx: AdapterContext): IRResponse {
  const choice = body?.choices?.[0];
  const message = choice?.message ?? {};
  let content = '';
  if (typeof message.content === 'string') {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    content = message.content
      .filter((c: any) => c?.type === 'text')
      .map((c: any) => c.text ?? '')
      .join('');
  }
  const toolCalls = (message.tool_calls ?? []).map((tc: any, i: number) => ({
    index: i,
    id: tc.id,
    name: tc.function?.name ?? '',
    arguments: tc.function?.arguments ?? '',
    extra_content: tc.function?.thought_signature,
  }));
  const usage = body?.usage;
  return {
    id: body?.id ?? `chatcmpl-${Date.now()}`,
    model: ctx.model,
    content,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    finish_reason: choice?.finish_reason ?? null,
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens ?? 0,
          output_tokens: usage.completion_tokens ?? 0,
          total_tokens: usage.total_tokens ?? 0,
        }
      : undefined,
  };
}

function createOpenAIStreamState(): StreamState {
  return { contentBlockIndex: 0, toolArgs: {}, toolNames: {}, toolIds: {} };
}

function fromOpenAIStreamEvent(payload: any, state: StreamState, ctx: AdapterContext): IRStreamEvent[] {
  if (!payload || !payload.choices) return [];
  const events: IRStreamEvent[] = [];
  const choice = payload.choices[0];
  const delta = choice?.delta ?? {};

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    events.push({ type: 'text', text: delta.content });
  }
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    events.push({ type: 'reasoning', text: delta.reasoning_content });
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const index = tc.index ?? 0;
      const args = tc.function?.arguments;
      const name = tc.function?.name;
      const id = tc.id;
      if (args !== undefined) {
        state.toolArgs[index] = (state.toolArgs[index] ?? '') + args;
      }
      if (name) state.toolNames[index] = name;
      if (id) state.toolIds[index] = id;
      events.push({
        type: 'tool-call',
        index,
        ...(id ? { id } : {}),
        ...(name ? { name } : {}),
        ...(args !== undefined ? { arguments: args } : {}),
      });
    }
  }
  if (choice?.finish_reason) {
    events.push({ type: 'done', finish_reason: choice.finish_reason });
  }
  if (payload.usage) {
    events.push({
      type: 'usage',
      usage: {
        input_tokens: payload.usage.prompt_tokens ?? 0,
        output_tokens: payload.usage.completion_tokens ?? 0,
        total_tokens: payload.usage.total_tokens ?? 0,
      },
      finish_reason: choice?.finish_reason ?? null,
    });
  }
  return events;
}

// ==================== 入口响应序列化 ====================

function serializeOpenAIResponse(ir: IRResponse, requestedModel: string): any {
  const message: any = { role: 'assistant' };
  if (ir.tool_calls && ir.tool_calls.length > 0) {
    message.content = ir.content || null;
    message.tool_calls = ir.tool_calls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: tc.arguments,
        ...(tc.extra_content ? { thought_signature: tc.extra_content } : {}),
      },
    }));
  } else {
    message.content = ir.content;
  }
  return {
    id: ir.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: ir.finish_reason ?? 'stop',
      },
    ],
    usage: ir.usage
      ? {
          prompt_tokens: ir.usage.input_tokens,
          completion_tokens: ir.usage.output_tokens,
          total_tokens: ir.usage.total_tokens,
        }
      : undefined,
  };
}

function createOpenAIEntryState(): EntryStreamState {
  return { started: false, contentBlockStarted: false, contentBlockIndex: 0 };
}

function serializeOpenAIStreamEvent(
  evt: IRStreamEvent,
  requestedModel: string,
  state: EntryStreamState,
): string | null {
  const id = `chatcmpl-${Date.now()}`;
  const chunkBase = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
  };

  if (evt.type === 'start') {
    state.started = true;
    return `data: ${JSON.stringify({
      ...chunkBase,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    })}\n\n`;
  }
  if (evt.type === 'text') {
    return `data: ${JSON.stringify({
      ...chunkBase,
      choices: [{ index: 0, delta: { content: evt.text }, finish_reason: null }],
    })}\n\n`;
  }
  if (evt.type === 'reasoning') {
    return `data: ${JSON.stringify({
      ...chunkBase,
      choices: [{ index: 0, delta: { reasoning_content: evt.text }, finish_reason: null }],
    })}\n\n`;
  }
  if (evt.type === 'tool-call') {
    const delta: any = { tool_calls: [{ index: evt.index }] };
    if (evt.id) delta.tool_calls[0].id = evt.id;
    delta.tool_calls[0].function = {
      ...(evt.name ? { name: evt.name } : {}),
      ...(evt.arguments !== undefined ? { arguments: evt.arguments } : {}),
    };
    return `data: ${JSON.stringify({
      ...chunkBase,
      choices: [{ index: 0, delta, finish_reason: null }],
    })}\n\n`;
  }
  if (evt.type === 'done' || evt.type === 'usage') {
    const finish = evt.finish_reason ?? (evt.type === 'done' ? evt.type : null);
    let out = `data: ${JSON.stringify({
      ...chunkBase,
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
    })}\n\n`;
    if (evt.type === 'usage' && (evt as any).usage) {
      out += `data: ${JSON.stringify({
        ...chunkBase,
        choices: [],
        usage: {
          prompt_tokens: evt.usage.input_tokens,
          completion_tokens: evt.usage.output_tokens,
          total_tokens: evt.usage.total_tokens,
        },
      })}\n\n`;
    }
    return out;
  }
  if (evt.type === 'error') {
    return `data: ${JSON.stringify({
      error: { message: evt.message, type: 'api_error', code: evt.code ?? 'transmux_error' },
    })}\n\n`;
  }
  return null;
}

function openaiStreamDone(): string {
  return 'data: [DONE]\n\n';
}

// ==================== 上游：Responses 变体 ====================

function toOpenAIResponsesUpstream(ir: IRRequest): any {
  const systemMessages = ir.messages.filter(m => m.role === 'system');
  const nonSystem = ir.messages.filter(m => m.role !== 'system');
  const body: any = {
    model: ir.forwardModel,
    ...(ir.stream ? { stream: true } : {}),
  };
  if (systemMessages.length > 0) {
    body.instructions = systemMessages.map(m => m.content ?? '').join('\n');
  }
  // input: Responses 格式（字符串或 input 对象数组）
  const input: any[] = [];
  for (const m of nonSystem) {
    if (m.role === 'user') {
      const parts = m.parts ?? (m.content ? [{ type: 'text', text: m.content }] : []);
      const content: any[] = [];
      for (const p of parts) {
        if (p.type === 'text') content.push({ type: 'input_text', text: p.text });
        else if (p.type === 'image') {
          content.push({
            type: 'input_image',
            image_url: p.url ? p.url : p.data ? `data:${p.media_type ?? 'image/png'};base64,${p.data}` : '',
          });
        }
      }
      input.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      const parts = m.parts ?? [];
      const text = parts.filter(p => p.type === 'text').map(p => p.text).join('');
      const toolCalls = parts.filter(p => p.type === 'tool-call');
      if (text) input.push({ role: 'assistant', content: [{ type: 'input_text', text }] });
      for (const tc of toolCalls) {
        input.push({
          type: 'function_call',
          name: tc.name,
          arguments: tc.arguments,
          call_id: tc.id ?? `call_${Date.now()}`,
        });
      }
    } else if (m.role === 'tool') {
      const tr = m.parts?.find(p => p.type === 'tool-result') as any;
      input.push({
        type: 'function_call_output',
        call_id: tr?.tool_call_id ?? `call_${Date.now()}`,
        output: tr?.content ?? m.content ?? '',
      });
    }
  }
  body.input = input;
  if (ir.params.max_tokens !== undefined) body.max_output_tokens = ir.params.max_tokens;
  if (ir.params.temperature !== undefined) body.temperature = ir.params.temperature;
  if (ir.params.top_p !== undefined) body.top_p = ir.params.top_p;
  if (ir.params.extra?.reasoning) body.reasoning = ir.params.extra.reasoning;
  if (ir.tools && ir.tools.length > 0) {
    body.tools = ir.tools.map(t => ({
      type: 'function',
      name: t.function.name,
      ...(t.function.description ? { description: t.function.description } : {}),
      ...(t.function.parameters ? { parameters: t.function.parameters } : {}),
      ...(typeof t.function.strict === 'boolean' ? { strict: t.function.strict } : {}),
    }));
  }
  if (ir.tool_choice) {
    body.tool_choice = typeof ir.tool_choice === 'string' ? ir.tool_choice : { type: 'function', name: ir.tool_choice.function.name };
  }
  return body;
}

function fromOpenAIResponsesUpstream(body: any, ctx: AdapterContext): IRResponse {
  const output = body?.output ?? [];
  let content = '';
  const toolCalls: IRResponse['tool_calls'] = [];
  for (const item of output) {
    if (item?.type === 'message') {
      content += (item.content ?? [])
        .filter((c: any) => c?.type === 'output_text' && c.text)
        .map((c: any) => c.text)
        .join('');
    } else if (item?.type === 'function_call' && item?.name) {
      toolCalls.push({
        id: item.call_id ?? item.id,
        name: item.name,
        arguments: item.arguments ?? '{}',
      });
    }
  }
  const usage = body?.usage;
  return {
    id: body?.id ?? `resp_${Date.now()}`,
    model: ctx.model,
    content,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    finish_reason: body?.status === 'incomplete' ? 'length' : 'stop',
    usage: usage
      ? {
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          total_tokens: usage.total_tokens ?? 0,
        }
      : undefined,
  };
}

function fromOpenAIResponsesStreamEvent(payload: any, state: StreamState, ctx: AdapterContext): IRStreamEvent[] {
  const events: IRStreamEvent[] = [];
  const type = payload?.type;
  if (type === 'response.output_text.delta') {
    if (payload.delta) events.push({ type: 'text', text: payload.delta });
  } else if (type === 'response.reasoning_summary_text.delta') {
    if (payload.delta) events.push({ type: 'reasoning', text: payload.delta });
  } else if (type === 'response.function_call_arguments.delta') {
    const idx = state.contentBlockIndex;
    if (payload.delta) {
      state.toolArgs[idx] = (state.toolArgs[idx] ?? '') + payload.delta;
      events.push({ type: 'tool-call', index: idx, arguments: payload.delta });
    }
  } else if (type === 'response.output_item.added') {
    const item = payload?.item;
    if (item?.type === 'function_call' && item?.name) {
      const idx = state.contentBlockIndex;
      state.toolNames[idx] = item.name;
      state.toolIds[idx] = item.call_id;
      events.push({
        type: 'tool-call',
        index: idx,
        id: item.call_id,
        name: item.name,
        arguments: '',
      });
      state.contentBlockIndex++;
    }
  } else if (type === 'response.completed' || type === 'response.incomplete') {
    const status = payload?.response?.status;
    events.push({
      type: 'done',
      finish_reason: status === 'incomplete' ? 'length' : 'stop',
    });
    const usage = payload?.response?.usage;
    if (usage) {
      events.push({
        type: 'usage',
        usage: {
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          total_tokens: usage.total_tokens ?? 0,
        },
      });
    }
  } else if (type === 'response.failed') {
    events.push({
      type: 'error',
      message: payload?.error?.message ?? 'Responses API error',
      code: payload?.error?.code,
    });
  }
  return events;
}

// ==================== 入口请求解析 ====================

/** 解析 OpenAI Responses API 请求体 -> IR */
function parseResponsesRequest(
  body: any,
  ctx: { requestedModel: string; forwardModel: string; stream: boolean; variant?: string }
): IRRequest {
  const messages: IRMessage[] = [];
  if (body?.instructions) {
    messages.push({
      role: 'system',
      content: Array.isArray(body.instructions)
        ? body.instructions.map((i: any) => i?.text ?? '').join('\n')
        : String(body.instructions),
    });
  }

  const pushInput = (item: any, role: IRMessage['role']) => {
    if (typeof item === 'string') {
      messages.push({ role, content: item });
      return;
    }
    if (!item || typeof item !== 'object') return;
    const content = item.content;
    if (typeof content === 'string') {
      messages.push({ role, content });
      return;
    }
    if (Array.isArray(content)) {
      const parts: IRMessagePart[] = [];
      for (const c of content) {
        if (!isPlainObject(c)) continue;
        if (c.type === 'input_text' && typeof c.text === 'string') {
          parts.push({ type: 'text', text: c.text });
        } else if ((c.type === 'input_image' || c.type === 'image_url') && c.image_url) {
          const url = typeof c.image_url === 'string' ? c.image_url : c.image_url.url;
          parts.push({ type: 'image', url: typeof url === 'string' ? url : undefined });
        } else if (c.type === 'function_call_output') {
          parts.push({
            type: 'tool-result',
            tool_call_id: typeof c.call_id === 'string' ? c.call_id : undefined,
            content: typeof c.output === 'string' ? c.output : JSON.stringify(c.output ?? ''),
          });
        }
      }
      // 纯文本 input 归一化为 content 字段
      if (parts.length > 0 && parts.every(p => p.type === 'text')) {
        messages.push({ role, content: parts.map(p => (p as any).text).join('\n') });
      } else if (parts.length > 0) {
        messages.push({ role, parts });
      }
    }
  };

  const input = body?.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    // Responses input 数组可能含 role 前缀项（如 [{role:'user',content:[...]}]）
    let pendingRole: IRMessage['role'] = 'user';
    for (const item of input) {
      if (isPlainObject(item) && typeof item.role === 'string' && !('content' in item) && !('type' in item)) {
        pendingRole = item.role === 'assistant' ? 'assistant' : 'user';
      } else {
        pushInput(item, pendingRole);
      }
    }
  } else if (isPlainObject(input) && Array.isArray(input.content)) {
    pushInput(input, 'user');
  }

  // Responses 中 assistant 的 function_call 输出（流式/非流式历史）
  if (Array.isArray(input) && Array.isArray(body?.output)) {
    // 历史输出回传
  }

  const tools = Array.isArray(body?.tools)
    ? body.tools.map((t: any) => {
        // Responses 格式：{type:'function', name, description, parameters, strict}
        if (t?.type === 'function' && t?.name) {
          return {
            type: 'function' as const,
            function: {
              name: t.name,
              ...(t.description ? { description: t.description } : {}),
              ...(t.parameters ? { parameters: t.parameters } : {}),
              ...(typeof t.strict === 'boolean' ? { strict: t.strict } : {}),
            },
          };
        }
        // chat 风格兜底
        return {
          type: 'function' as const,
          function: {
            name: t?.function?.name ?? '',
            ...(t?.function?.description ? { description: t.function.description } : {}),
            ...(t?.function?.parameters ? { parameters: t.function.parameters } : {}),
          },
        };
      })
    : undefined;

  let tool_choice: IRRequest['tool_choice'] | undefined;
  const tc = body?.tool_choice;
  if (typeof tc === 'string') {
    tool_choice = tc === 'required' ? 'required' : tc === 'none' ? 'none' : 'auto';
  } else if (isPlainObject(tc) && tc?.type === 'function' && tc?.name) {
    tool_choice = { type: 'function', function: { name: tc.name } };
  }

  const params: IRRequest['params'] = {};
  if (body?.temperature !== undefined) params.temperature = body.temperature;
  if (body?.top_p !== undefined) params.top_p = body.top_p;
  if (body?.max_output_tokens !== undefined) params.max_tokens = body.max_output_tokens;
  if (body?.presence_penalty !== undefined) params.presence_penalty = body.presence_penalty;
  if (body?.frequency_penalty !== undefined) params.frequency_penalty = body.frequency_penalty;
  if (body?.reasoning !== undefined) {
    params.extra = { ...(params.extra ?? {}), reasoning: body.reasoning };
  }

  return {
    model: ctx.requestedModel,
    forwardModel: ctx.forwardModel,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
    params,
    stream: ctx.stream,
  };
}

/** 序列化非流式 Responses 响应 */
function serializeOpenAIResponsesResponse(ir: IRResponse, requestedModel: string): any {
  const output: any[] = [];
  if (ir.content) {
    output.push({
      type: 'message',
      id: `msg_${Date.now()}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: ir.content, annotations: [] }],
    });
  }
  if (ir.tool_calls && ir.tool_calls.length > 0) {
    for (const tc of ir.tool_calls) {
      output.push({
        type: 'function_call',
        id: `fc_${Date.now()}_${tc.index ?? 0}`,
        call_id: tc.id ?? `call_${Date.now()}_${tc.index ?? 0}`,
        name: tc.name,
        arguments: tc.arguments,
        status: 'completed',
      });
    }
  }
  const status = ir.finish_reason === 'length' ? 'incomplete' : 'completed';
  return {
    id: ir.id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: requestedModel,
    output,
    usage: ir.usage
      ? {
          input_tokens: ir.usage.input_tokens,
          output_tokens: ir.usage.output_tokens,
          total_tokens: ir.usage.total_tokens,
        }
      : undefined,
  };
}

/** 序列化流式 Responses 事件为 SSE 文本 */
function serializeOpenAIResponsesStreamEvent(
  evt: IRStreamEvent,
  requestedModel: string,
  state: EntryStreamState,
): string | null {
  const out: string[] = [];
  const itemId = `msg_${state.contentBlockIndex || Date.now()}`;

  if (evt.type === 'start') {
    out.push(`event: response.created\ndata: ${JSON.stringify({
      type: 'response.created',
      response: { id: evt.id ?? `resp_${Date.now()}`, object: 'response', created_at: Math.floor(Date.now() / 1000), model: requestedModel, output: [], status: 'in_progress' },
    })}\n\n`);
    out.push(`event: response.in_progress\ndata: ${JSON.stringify({ type: 'response.in_progress' })}\n\n`);
    out.push(`event: response.output_item.added\ndata: ${JSON.stringify({
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: itemId, type: 'message', role: 'assistant', content: [], status: 'in_progress' },
    })}\n\n`);
    out.push(`event: response.content_part.added\ndata: ${JSON.stringify({
      type: 'response.content_part.added',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    })}\n\n`);
    return out.join('');
  }
  if (evt.type === 'text') {
    out.push(`event: response.output_text.delta\ndata: ${JSON.stringify({
      type: 'response.output_text.delta',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: evt.text,
    })}\n\n`);
    return out.join('');
  }
  if (evt.type === 'reasoning') {
    out.push(`event: response.reasoning_summary_text.delta\ndata: ${JSON.stringify({
      type: 'response.reasoning_summary_text.delta',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: evt.text,
    })}\n\n`);
    return out.join('');
  }
  if (evt.type === 'tool-call') {
    // 工具调用在 responses 流中表达为 function_call 项
    if (evt.name) {
      out.push(`event: response.output_item.added\ndata: ${JSON.stringify({
        type: 'response.output_item.added',
        output_index: evt.index + 1,
        item: {
          id: `fc_${Date.now()}`,
          type: 'function_call',
          call_id: evt.id ?? `call_${Date.now()}`,
          name: evt.name,
          arguments: '',
          status: 'in_progress',
        },
      })}\n\n`);
    }
    if (evt.arguments) {
      out.push(`event: response.function_call_arguments.delta\ndata: ${JSON.stringify({
        type: 'response.function_call_arguments.delta',
        item_id: `fc_${Date.now()}`,
        output_index: evt.index + 1,
        delta: evt.arguments,
      })}\n\n`);
    }
    return out.join('');
  }
  if (evt.type === 'done' || evt.type === 'usage') {
    const status = evt.finish_reason === 'length' ? 'incomplete' : 'completed';
    out.push(`event: response.completed\ndata: ${JSON.stringify({
      type: 'response.completed',
      response: {
        id: `resp_${Date.now()}`,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        model: requestedModel,
        status,
        output: [],
        usage: evt.type === 'usage' && evt.usage
          ? {
              input_tokens: evt.usage.input_tokens,
              output_tokens: evt.usage.output_tokens,
              total_tokens: evt.usage.total_tokens,
            }
          : undefined,
      },
    })}\n\n`);
    return out.join('');
  }
  if (evt.type === 'error') {
    out.push(`event: response.failed\ndata: ${JSON.stringify({
      type: 'response.failed',
      response: { id: `resp_${Date.now()}`, object: 'response', status: 'failed' },
      error: { code: evt.code ?? 'transmux_error', message: evt.message },
    })}\n\n`);
    return out.join('');
  }
  return null;
}

function openaiResponsesStreamDone(): string {
  return 'data: [DONE]\n\n';
}

export const openaiAdapter: TransmuxAdapter = {
  protocol: 'openai',
  variants: ['chat-completions', 'responses'],
  parseRequest(body: any, ctx: { requestedModel: string; forwardModel: string; stream: boolean; variant?: string }): IRRequest {
    if (ctx.variant === 'responses') {
      return parseResponsesRequest(body, ctx);
    }
    const messages: IRMessage[] = [];
    for (const m of body?.messages ?? []) {
      const role = m?.role === 'tool' ? 'tool' : m?.role === 'assistant' ? 'assistant' : 'user';
      if (typeof m?.content === 'string') {
        messages.push({ role, content: m.content });
      } else if (Array.isArray(m.content)) {
        const parts = parseContent(m.content);
        messages.push({ role, ...(parts && parts.length > 0 ? { parts } : { content: '' }) });
      } else {
        messages.push({ role, content: '' });
      }
    }
    const tools = Array.isArray(body?.tools)
      ? body.tools.map((t: any) => ({
          type: 'function' as const,
          function: {
            name: t?.function?.name ?? '',
            ...(t?.function?.description ? { description: t.function.description } : {}),
            ...(t?.function?.parameters ? { parameters: t.function.parameters } : {}),
            ...(t?.function?.thought_signature ? { thought_signature: t.function.thought_signature } : {}),
          },
        }))
      : undefined;
    const params: IRRequest['params'] = {};
    if (body?.temperature !== undefined) params.temperature = body.temperature;
    if (body?.top_p !== undefined) params.top_p = body.top_p;
    if (body?.max_tokens !== undefined) params.max_tokens = body.max_tokens;
    if (body?.stop !== undefined) params.stop = Array.isArray(body.stop) ? body.stop : [body.stop];
    if (body?.presence_penalty !== undefined) params.presence_penalty = body.presence_penalty;
    if (body?.frequency_penalty !== undefined) params.frequency_penalty = body.frequency_penalty;
    if (body?.seed !== undefined) params.seed = body.seed;
    if (body?.response_format !== undefined) params.response_format = body.response_format;
    return {
      model: ctx.requestedModel,
      forwardModel: ctx.forwardModel,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(body?.tool_choice ? { tool_choice: body.tool_choice } : {}),
      params,
      stream: ctx.stream,
    };
  },

  toRequest: (ir, c) => c?.variant === 'responses' ? toOpenAIResponsesUpstream(ir) : toOpenAIRequest(ir),
  fromResponse: (body, ctx) => ctx.variant === 'responses' ? fromOpenAIResponsesUpstream(body, ctx) : fromOpenAIResponse(body, ctx),
  createStreamState: createOpenAIStreamState,
  fromStreamEvent: (payload, state, ctx) => ctx.variant === 'responses'
    ? fromOpenAIResponsesStreamEvent(payload, state, ctx)
    : fromOpenAIStreamEvent(payload, state, ctx),
  serializeResponse: (ir, requestedModel, variant) => variant === 'responses'
    ? serializeOpenAIResponsesResponse(ir, requestedModel)
    : serializeOpenAIResponse(ir, requestedModel),
  createEntryState: createOpenAIEntryState,
  serializeStreamEvent: (evt, requestedModel, state, variant) => variant === 'responses'
    ? serializeOpenAIResponsesStreamEvent(evt, requestedModel, state)
    : serializeOpenAIStreamEvent(evt, requestedModel, state),
  streamDone: openaiStreamDone,

  // ---------- 图片生成（OpenAI 原生格式直通） ----------
  parseImageRequest(body: any, ctx: { requestedModel: string; forwardModel: string }): any {
    return {
      model: ctx.requestedModel,
      forwardModel: ctx.forwardModel,
      prompt: body?.prompt ?? '',
      n: body?.n,
      size: body?.size,
      quality: body?.quality,
      style: body?.style,
      response_format: body?.response_format,
      reference_images: body?.image ? [{ data: body.image }] : undefined,
    };
  },
  toImageRequest(ir: any): any {
    const body: any = {
      model: ir.forwardModel,
      prompt: ir.prompt,
    };
    if (ir.n) body.n = ir.n;
    if (ir.size) body.size = ir.size;
    if (ir.quality) body.quality = ir.quality;
    if (ir.style) body.style = ir.style;
    if (ir.response_format) body.response_format = ir.response_format;
    return body;
  },
  fromImageResponse(body: any, _requestedModel: string): any {
    return {
      created: body?.created ?? Math.floor(Date.now() / 1000),
      data: body?.data ?? [],
    };
  },
  serializeImageResponse(ir: any, _requestedModel: string): any {
    return { created: ir.created, data: ir.data };
  },

  // ---------- 嵌入（OpenAI 原生格式直通） ----------
  parseEmbeddingRequest(body: any, ctx: { requestedModel: string; forwardModel: string }): any {
    return {
      model: ctx.requestedModel,
      forwardModel: ctx.forwardModel,
      input: body?.input ?? [],
      encoding_format: body?.encoding_format,
    };
  },
  toEmbeddingRequest(ir: any): any {
    return {
      model: ir.forwardModel,
      input: ir.input,
      ...(ir.encoding_format ? { encoding_format: ir.encoding_format } : {}),
    };
  },
  fromEmbeddingResponse(body: any, requestedModel: string): any {
    return {
      object: 'list',
      data: body?.data ?? [],
      model: requestedModel,
      usage: body?.usage ?? { prompt_tokens: 0, total_tokens: 0 },
    };
  },
  serializeEmbeddingResponse(ir: any, _requestedModel: string): any {
    return ir;
  },

  // ---------- 重排序（OpenAI/Cohere 格式直通） ----------
  parseRerankRequest(body: any, ctx: { requestedModel: string; forwardModel: string }): any {
    return {
      model: ctx.requestedModel,
      forwardModel: ctx.forwardModel,
      query: body?.query ?? '',
      documents: body?.documents ?? [],
      top_n: body?.top_n,
      return_documents: body?.return_documents,
      max_chunks_per_doc: body?.max_chunks_per_doc,
    };
  },
  toRerankRequest(ir: any): any {
    return {
      model: ir.forwardModel,
      query: ir.query,
      documents: ir.documents,
      ...(ir.top_n ? { top_n: ir.top_n } : {}),
      ...(ir.return_documents !== undefined ? { return_documents: ir.return_documents } : {}),
      ...(ir.max_chunks_per_doc ? { max_chunks_per_doc: ir.max_chunks_per_doc } : {}),
    };
  },
  fromRerankResponse(body: any, requestedModel: string): any {
    return {
      id: body?.id ?? `rerank-${Date.now()}`,
      results: body?.results ?? body?.data ?? [],
      model: requestedModel,
      usage: body?.usage ?? { total_tokens: 0 },
    };
  },
  serializeRerankResponse(ir: any, _requestedModel: string): any {
    return ir;
  },
};
