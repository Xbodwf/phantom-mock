/**
 * Transmux 库单元验证：跑通 3×3 协议转换矩阵（不碰网络）
 * 运行: tsx src/transmux/verify.ts
 */
import {
  openaiAdapter,
  anthropicAdapter,
  googleAdapter,
  getAdapter,
  type TransmuxAdapter,
  type AdapterContext,
} from './index.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

// 一份带多模态 + 工具调用的 IR 请求
const sampleIR = {
  model: 'client-model',
  forwardModel: 'upstream-model',
  messages: [
    { role: 'system', content: '你是助手' },
    { role: 'user', parts: [{ type: 'text', text: '看这张图' }, { type: 'image', url: 'https://example.com/a.png', media_type: 'image/png' }] },
    { role: 'assistant', parts: [{ type: 'text', text: '我来调用工具' }, { type: 'tool-call', id: 'call_1', name: 'get_weather', arguments: '{"city":"beijing"}' }] },
    { role: 'tool', parts: [{ type: 'tool-result', tool_call_id: 'call_1', name: 'get_weather', content: '{"temp":25}' }] },
  ],
  tools: [{ type: 'function', function: { name: 'get_weather', description: '查天气', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
  tool_choice: 'auto',
  params: { temperature: 0.7, max_tokens: 512 },
  stream: false,
} as any;

const ctx: AdapterContext = { protocol: 'openai', variant: 'chat-completions', model: 'upstream-model', stream: false };

console.log('\n=== 1. IR -> 各上游 toRequest ===\n');

// OpenAI
{
  const body: any = openaiAdapter.toRequest(sampleIR);
  check('openai.toRequest 有 system', body.messages[0].role === 'system' && body.messages[0].content === '你是助手', JSON.stringify(body));
  check('openai.toRequest 多模态 image_url', body.messages[1].content.some((c: any) => c.type === 'image_url' && c.image_url.url === 'https://example.com/a.png'));
  check('openai.toRequest assistant tool_calls', body.messages[2].tool_calls?.[0]?.function.name === 'get_weather');
  check('openai.toRequest tool 角色', body.messages[3].role === 'tool' && body.messages[3].tool_call_id === 'call_1');
  check('openai.toRequest 参数透传', body.temperature === 0.7 && body.max_tokens === 512 && body.tools.length === 1);
}

// Anthropic
{
  const body: any = anthropicAdapter.toRequest(sampleIR);
  check('anthropic.toRequest system 分离', body.system === '你是助手');
  const userMsg = body.messages.find((m: any) => m.role === 'user');
  check('anthropic.toRequest 图片转 source', userMsg?.content?.some((c: any) => c.type === 'image' && c.source.type === 'url'));
  const asst = body.messages.find((m: any) => m.role === 'assistant');
  check('anthropic.toRequest tool_use', asst?.content?.some((c: any) => c.type === 'tool_use' && c.name === 'get_weather'));
  check('anthropic.toRequest tool_result', body.messages.some((m: any) => m.content?.[0]?.type === 'tool_result'));
  check('anthropic.toRequest max_tokens 默认补齐', body.max_tokens === 512);
}

// Google
{
  const body: any = googleAdapter.toRequest(sampleIR);
  check('google.toRequest systemInstruction', body.systemInstruction?.parts?.[0]?.text === '你是助手');
  const user = body.contents.find((c: any) => c.role === 'user');
  check('google.toRequest 图片 fileData', user?.parts?.some((p: any) => p.fileData?.fileUri === 'https://example.com/a.png'), JSON.stringify(user?.parts));
  const model = body.contents.find((c: any) => c.role === 'model');
  check('google.toRequest functionCall', model?.parts?.some((p: any) => p.functionCall?.name === 'get_weather'));
  check('google.toRequest generationConfig', body.generationConfig?.maxOutputTokens === 512);
  check('google.toRequest tools', body.tools?.[0]?.functionDeclarations?.length === 1);
}

console.log('\n=== 2. 各上游非流式响应 -> IR -> 入口协议 ===\n');

// OpenAI 上游响应
{
  const upstream = {
    id: 'chatcmpl-abc', model: 'upstream-model',
    choices: [{ index: 0, message: { role: 'assistant', content: '晴，25度', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"beijing"}' } }] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
  const ir = openaiAdapter.fromResponse(upstream, ctx);
  check('openai.fromResponse 内容', ir.content === '晴，25度');
  check('openai.fromResponse tool_calls', ir.tool_calls?.[0]?.name === 'get_weather' && ir.finish_reason === 'tool_calls');
  check('openai.fromResponse usage', ir.usage?.total_tokens === 15);

  // 序列化回三个入口
  const o: any = openaiAdapter.serializeResponse(ir, 'client-model');
  check('->openai.serialize 有 tool_calls', o.choices[0].message.tool_calls?.[0]?.function.name === 'get_weather');
  const a: any = anthropicAdapter.serializeResponse(ir, 'client-model');
  check('->anthropic.serialize tool_use', a.content.some((c: any) => c.type === 'tool_use') && a.stop_reason === 'tool_use');
  const g: any = googleAdapter.serializeResponse(ir, 'client-model');
  check('->google.serialize functionCall', g.candidates[0].content.parts.some((p: any) => p.functionCall?.name === 'get_weather'));
}

// Anthropic 上游响应
{
  const upstream = {
    id: 'msg_xyz', type: 'message', role: 'assistant', model: 'upstream-model',
    content: [{ type: 'text', text: '多云' }, { type: 'tool_use', id: 'tu1', name: 'get_weather', input: { city: 'shanghai' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 8, output_tokens: 3 },
  };
  const ir = anthropicAdapter.fromResponse(upstream, ctx);
  check('anthropic.fromResponse 内容', ir.content === '多云');
  check('anthropic.fromResponse tool', ir.tool_calls?.[0]?.name === 'get_weather' && ir.finish_reason === 'tool_calls');
  const o: any = openaiAdapter.serializeResponse(ir, 'client-model');
  check('->openai.serialize finish_reason', o.choices[0].finish_reason === 'tool_calls');
}

// Google 上游响应
{
  const upstream = {
    candidates: [{ content: { parts: [{ text: '晴' }, { functionCall: { name: 'get_weather', args: { city: 'gz' } } }], role: 'model' }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
  };
  const ir = googleAdapter.fromResponse(upstream, ctx);
  check('google.fromResponse 内容', ir.content === '晴');
  check('google.fromResponse tool', ir.tool_calls?.[0]?.name === 'get_weather' && ir.finish_reason === 'stop');
  const o: any = openaiAdapter.serializeResponse(ir, 'client-model');
  check('->openai.serialize', o.choices[0].message.content === '晴' && o.usage.total_tokens === 6);
}

console.log('\n=== 3. 流式转换（上游 SSE -> 入口 SSE）===\n');

function simulateStream(adapter: TransmuxAdapter, payloads: any[]) {
  const state = adapter.createStreamState();
  const events: any[] = [];
  for (const p of payloads) {
    events.push(...adapter.fromStreamEvent(p, state, ctx));
  }
  return events;
}

// OpenAI 流式 payloads
{
  const events = simulateStream(openaiAdapter, [
    { choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { content: '你' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { reasoning_content: '思考中' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_weather', arguments: '{"city"' } }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':"beijing"}' } }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
  ]);
  check('openai 流式 文本累积', events.filter(e => e.type === 'text').map(e => e.text).join('') === '你');
  check('openai 流式 reasoning', events.some(e => e.type === 'reasoning' && e.text === '思考中'));
  const toolArgEvents = events.filter(e => e.type === 'tool-call');
  const accumulated = toolArgEvents.map((e: any) => e.arguments ?? '').join('');
  check('openai 流式 tool args 增量累积', accumulated === '{"city":"beijing"}');
  check('openai 流式 done+usage', events.some(e => e.type === 'done') && events.some(e => e.type === 'usage' && e.usage.total_tokens === 5));

  // 序列化回 Anthropic 入口
  const es = anthropicAdapter.createEntryState();
  let out = '';
  for (const e of events) out += anthropicAdapter.serializeStreamEvent(e, 'client-model', es) ?? '';
  check('openai流->anthropic入口 含 thinking_delta', out.includes('thinking_delta'));
  check('openai流->anthropic入口 含 input_json_delta', out.includes('input_json_delta'));
  check('openai流->anthropic入口 含 message_stop', out.includes('message_stop'));
}

// Anthropic 流式 payloads
{
  const events = simulateStream(anthropicAdapter, [
    { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 3 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'get_weather', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city"' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"x"}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ]);
  check('anthropic 流式 start', events.some(e => e.type === 'start'));
  check('anthropic 流式 文本', events.filter(e => e.type === 'text').map(e => e.text).join('') === '你好');
  check('anthropic 流式 tool json 累积', (events.filter(e => e.type === 'tool-call').map((e: any) => e.arguments ?? '').join('')) === '{"city":"x"}');
  check('anthropic 流式 done', events.some(e => e.type === 'done' && e.finish_reason === 'tool_calls'));

  const es = openaiAdapter.createEntryState();
  let out = '';
  for (const e of events) out += openaiAdapter.serializeStreamEvent(e, 'client-model', es) ?? '';
  check('anthropic流->openai入口 含 delta content', out.includes('"content":"你好"'));
  check('anthropic流->openai入口 含 tool_calls', out.includes('tool_calls'));
  check('anthropic流->openai入口 done', out.includes('"finish_reason":"tool_calls"'));
}

// Google 流式 payloads
{
  const events = simulateStream(googleAdapter, [
    { candidates: [{ content: { parts: [{ text: '今天' }], role: 'model' } }] },
    { candidates: [{ content: { parts: [{ text: '晴天' }], role: 'model' } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: 'get_weather', args: { city: 'bj' } } }] }, finishReason: 'STOP' }] },
    { usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 } },
  ]);
  check('google 流式 文本累积', events.filter(e => e.type === 'text').map(e => e.text).join('') === '今天晴天');
  check('google 流式 tool', events.some(e => e.type === 'tool-call' && e.name === 'get_weather'));
  check('google 流式 done', events.some(e => e.type === 'done'));

  const es = openaiAdapter.createEntryState();
  let out = '';
  for (const e of events) out += openaiAdapter.serializeStreamEvent(e, 'client-model', es) ?? '';
  out += openaiAdapter.streamDone();
  check('google流->openai入口', out.includes('"content":"今天"') && out.includes('"content":"晴天"') && out.includes('[DONE]'));
}

console.log('\n=== 4. 入口请求解析 ===\n');

{
  const ir = openaiAdapter.parseRequest({
    model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true,
  }, { requestedModel: 'm', forwardModel: 'up', stream: true });
  check('openai 入口解析', ir.messages[0].role === 'user' && ir.messages[0].content === 'hi' && ir.stream === true);
}
{
  const ir = anthropicAdapter.parseRequest({
    model: 'm', system: 'sys', max_tokens: 100,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], stream: true,
  }, { requestedModel: 'm', forwardModel: 'up', stream: true });
  check('anthropic 入口解析 system', ir.messages[0].role === 'system' && ir.messages[0].content === 'sys');
  check('anthropic 入口解析 max_tokens', ir.params.max_tokens === 100);
}
{
  const ir = googleAdapter.parseRequest({
    model: 'm',
    systemInstruction: { parts: [{ text: 'sys' }] },
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    generationConfig: { maxOutputTokens: 200 },
  }, { requestedModel: 'm', forwardModel: 'up', stream: false });
  check('google 入口解析', ir.messages[0].role === 'system' && ir.messages[1].role === 'user');
  check('google 入口解析 max_tokens', ir.params.max_tokens === 200);
}

// 注册表完整性
check('注册表 3 协议', !!getAdapter('openai') && !!getAdapter('anthropic') && !!getAdapter('google'));

console.log('\n=== 5. /v1/responses 变体 ===\n');

{
  // 入口：Responses 请求体 -> IR
  const ir = openaiAdapter.parseRequest({
    model: 'm',
    instructions: '你是助手',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: '你好' }] },
    ],
    max_output_tokens: 200,
    stream: true,
    tools: [{ type: 'function', name: 'get_weather', description: '查天气', parameters: { type: 'object', properties: {} } }],
  }, { requestedModel: 'm', forwardModel: 'up', stream: true, variant: 'responses' });
  check('responses 入口 instructions', ir.messages[0].role === 'system' && ir.messages[0].content === '你是助手');
  check('responses 入口 input', ir.messages[1].role === 'user' && ir.messages[1].content === '你好');
  check('responses 入口 max_tokens', ir.params.max_tokens === 200);
  check('responses 入口 tools', ir.tools?.[0]?.function.name === 'get_weather');

  // 上游：Responses 响应 -> IR
  const up = {
    id: 'resp_1', object: 'response', status: 'completed', model: 'up',
    output: [
      { type: 'message', content: [{ type: 'output_text', text: '天气晴' }] },
      { type: 'function_call', call_id: 'fc1', name: 'get_weather', arguments: '{"city":"bj"}' },
    ],
    usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
  };
  const irResp = openaiAdapter.fromResponse(up, { protocol: 'openai', variant: 'responses', model: 'up', stream: false });
  check('responses 上游解析内容', irResp.content === '天气晴');
  check('responses 上游解析 tool', irResp.tool_calls?.[0]?.name === 'get_weather');

  // 入口：IR -> Responses 非流式
  const serialized: any = openaiAdapter.serializeResponse(irResp, 'm', 'responses');
  check('responses 出口 object', serialized.object === 'response' && serialized.status === 'completed');
  check('responses 出口 output_text', serialized.output[0].content[0].type === 'output_text');
  check('responses 出口 function_call', serialized.output[1].type === 'function_call');

  // 上游：Responses 流式 payloads -> IR
  const state = openaiAdapter.createStreamState();
  let events: any[] = [];
  const ctx = { protocol: 'openai', variant: 'responses', model: 'up', stream: true } as AdapterContext;
  for (const p of [
    { type: 'response.created', response: { id: 'resp_1' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1' } },
    { type: 'response.output_text.delta', delta: '天' },
    { type: 'response.output_text.delta', delta: '气晴' },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc1', call_id: 'fc1', name: 'get_weather' } },
    { type: 'response.function_call_arguments.delta', delta: '{"city"' },
    { type: 'response.function_call_arguments.delta', delta: ':"bj"}' },
    { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } },
  ]) {
    events.push(...openaiAdapter.fromStreamEvent(p, state, ctx));
  }
  check('responses 流式文本', events.filter(e => e.type === 'text').map(e => e.text).join('') === '天气晴');
  check('responses 流式 tool 名', events.some(e => e.type === 'tool-call' && e.name === 'get_weather'));
  check('responses 流式 tool args 累积', events.filter(e => e.type === 'tool-call').map((e: any) => e.arguments ?? '').join('') === '{"city":"bj"}', JSON.stringify(events.filter(e => e.type === 'tool-call')).replace(/\\"/g, '"'));
  check('responses 流式 done+usage', events.some(e => e.type === 'done' && e.finish_reason === 'stop') && events.some(e => e.type === 'usage'));

  // 入口：IR 流事件 -> Responses SSE
  const es = openaiAdapter.createEntryState();
  let out = '';
  for (const e of events) out += openaiAdapter.serializeStreamEvent(e, 'm', es, 'responses') ?? '';
  check('responses SSE 含 output_text.delta', out.includes('response.output_text.delta'));
  check('responses SSE 含 function_call_arguments.delta', out.includes('response.function_call_arguments.delta'));
  check('responses SSE 含 response.completed', out.includes('response.completed'));
}

console.log('\n=== 6. 跨协议管线验证（入口协议决定输出格式）===\n');

{
  // Anthropic 入口 -> OpenAI 上游
  const entryBody = {
    model: 'm', system: '你是助手', max_tokens: 100,
    messages: [{ role: 'user', content: '你好' }],
  };
  const ir = anthropicAdapter.parseRequest(entryBody, { requestedModel: 'm', forwardModel: 'up', stream: false });
  check('anthropic入口 解析', ir.messages[0].role === 'system' && ir.messages[1].content === '你好');

  const upstreamBody: any = openaiAdapter.toRequest(ir);
  check('anthropic入口->openai上游 body', upstreamBody.model === 'up' && upstreamBody.messages[0].content === '你是助手');

  // OpenAI 上游响应 -> Anthropic 入口格式
  const upstreamResp = {
    id: 'c1', choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  };
  const irResp = openaiAdapter.fromResponse(upstreamResp, { protocol: 'openai', variant: 'chat-completions', model: 'up', stream: false });
  const out: any = anthropicAdapter.serializeResponse(irResp, 'm');
  check('openai上游->anthropic入口 type=message', out.type === 'message' && out.role === 'assistant');
  check('openai上游->anthropic入口 text block', out.content[0].type === 'text' && out.content[0].text === 'hello');
  check('openai上游->anthropic入口 usage', out.usage.input_tokens === 2 && out.usage.output_tokens === 1);
}

{
  // Anthropic 入口流式 -> Gemini 上游流式事件 -> Anthropic SSE 输出
  const geminiStream = [
    { candidates: [{ content: { parts: [{ text: '今天' }], role: 'model' } }] },
    { candidates: [{ content: { parts: [{ text: '晴天' }], role: 'model' } }], finishReason: 'STOP' },
  ];
  const state = googleAdapter.createStreamState();
  const events: any[] = [];
  const gctx = { protocol: 'google', variant: 'stream-generate-content', model: 'up', stream: true } as AdapterContext;
  for (const p of geminiStream) events.push(...googleAdapter.fromStreamEvent(p, state, gctx));

  const es = anthropicAdapter.createEntryState();
  let out = '';
  for (const e of events) out += anthropicAdapter.serializeStreamEvent(e, 'm', es) ?? '';
  check('gemini流->anthropic入口 message_start', out.includes('event: message_start'));
  check('gemini流->anthropic入口 content_block_delta', out.includes('content_block_delta') && out.includes('"text":"今天"'));
  check('gemini流->anthropic入口 message_stop', out.includes('message_stop'));
}

{
  // Gemini 入口 -> Anthropic 上游（互转）
  const geminiBody = {
    systemInstruction: { parts: [{ text: 'sys' }] },
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    generationConfig: { maxOutputTokens: 50 },
  };
  const ir = googleAdapter.parseRequest(geminiBody, { requestedModel: 'g', forwardModel: 'claude-x', stream: false });
  const anthBody: any = anthropicAdapter.toRequest(ir);
  check('gemini入口->anthropic上游', anthBody.system === 'sys' && anthBody.messages[0].content === 'hi' && anthBody.max_tokens === 50);

  const anthResp = {
    id: 'msg_1', content: [{ type: 'text', text: 're' }], stop_reason: 'end_turn',
    usage: { input_tokens: 3, output_tokens: 2 },
  };
  const ir2 = anthropicAdapter.fromResponse(anthResp, { protocol: 'anthropic', variant: 'messages', model: 'claude-x', stream: false });
  const gemOut: any = googleAdapter.serializeResponse(ir2, 'g');
  check('anthropic上游->gemini入口', gemOut.candidates[0].content.parts[0].text === 're' && gemOut.usageMetadata.totalTokenCount === 5);
}

console.log('\n=== 7. 图片 / 嵌入 / 重排序（adapter 层）===\n');

{
  // 图片生成
  const ir: any = openaiAdapter.parseImageRequest?.({ model: 'm', prompt: '一只猫', n: 2, size: '1024x1024', response_format: 'b64_json' }, { requestedModel: 'm', forwardModel: 'up' });
  check('图片 parse', ir.prompt === '一只猫' && ir.forwardModel === 'up' && ir.n === 2);
  const upstreamBody: any = openaiAdapter.toImageRequest?.(ir);
  check('图片 toRequest', upstreamBody.model === 'up' && upstreamBody.n === 2 && upstreamBody.response_format === 'b64_json');
  const resp: any = openaiAdapter.fromImageResponse?.({ created: 123, data: [{ url: 'https://x/a.png' }] }, 'm');
  check('图片 fromResponse', resp.data[0].url === 'https://x/a.png');
  const serialized: any = openaiAdapter.serializeImageResponse?.(resp, 'm');
  check('图片 serialize', serialized.data.length === 1);
}

{
  // 嵌入
  const ir: any = openaiAdapter.parseEmbeddingRequest?.({ model: 'm', input: ['hello', 'world'] }, { requestedModel: 'm', forwardModel: 'up' });
  check('嵌入 parse', ir.input.length === 2 && ir.forwardModel === 'up');
  const upstreamBody: any = openaiAdapter.toEmbeddingRequest?.(ir);
  check('嵌入 toRequest', upstreamBody.model === 'up' && upstreamBody.input.length === 2);
  const resp: any = openaiAdapter.fromEmbeddingResponse?.({ object: 'list', data: [{ index: 0, embedding: [0.1] }], usage: { prompt_tokens: 2, total_tokens: 2 } }, 'm');
  check('嵌入 fromResponse', resp.data[0].embedding[0] === 0.1 && resp.model === 'm');
}

{
  // 重排序
  const ir: any = openaiAdapter.parseRerankRequest?.({ model: 'm', query: 'q', documents: ['a', 'b'], top_n: 1 }, { requestedModel: 'm', forwardModel: 'up' });
  check('重排 parse', ir.documents.length === 2 && ir.top_n === 1);
  const upstreamBody: any = openaiAdapter.toRerankRequest?.(ir);
  check('重排 toRequest', upstreamBody.top_n === 1);
  const resp: any = openaiAdapter.fromRerankResponse?.({ id: 'r1', results: [{ index: 0, relevance_score: 0.9 }], usage: { total_tokens: 5 } }, 'm');
  check('重排 fromResponse', resp.results[0].relevance_score === 0.9 && resp.model === 'm');
}

{
  // Gemini 嵌入
  const ir: any = googleAdapter.parseEmbeddingRequest?.({ model: 'm', input: 'hello' }, { requestedModel: 'm', forwardModel: 'up' });
  check('gemini嵌入 parse', Array.isArray(ir.input) && ir.input[0] === 'hello');
  const upstreamBody: any = googleAdapter.toEmbeddingRequest?.(ir);
  check('gemini嵌入 toRequest', upstreamBody.model === 'models/up' && upstreamBody.content.parts[0].text === 'hello');
  const resp: any = googleAdapter.fromEmbeddingResponse?.({ embedding: { values: [0.5, 0.6] } }, 'm');
  check('gemini嵌入 fromResponse', resp.data[0].embedding[0] === 0.5 && resp.data[0].index === 0);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
