/**
 * 端到端冒烟测试：起本地 mock 上游（openai/anthropic/gemini 三套端点），
 * 通过 transmux 管线验证真实 HTTP 往返转换。
 * 运行: tsx /tmp/opencode/e2e-transmux.ts
 */
import express from 'express';
import { registerAdapter } from '../src/transmux/registry.js';
import { openaiAdapter } from '../src/transmux/adapters/openai.js';
import { anthropicAdapter } from '../src/transmux/adapters/anthropic.js';
import { googleAdapter } from '../src/transmux/adapters/google.js';
import { transmuxCall, transmuxStream, type TransmuxTarget } from '../src/transmux/pipeline.js';
import type { Response } from 'express';

registerAdapter(openaiAdapter);
registerAdapter(anthropicAdapter);
registerAdapter(googleAdapter);

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
}

const upstream = express();
upstream.use(express.json());

// OpenAI 上游（非流式 + 流式）
upstream.post('/openai/chat/completions', (req, res) => {
  if (req.body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '来自' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'OpenAI' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  res.json({
    id: 'chatcmpl-e2e', choices: [{ index: 0, message: { role: 'assistant', content: '来自OpenAI上游' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  });
});

// Anthropic 上游（非流式 + 流式）
upstream.post('/anthropic/messages', (req, res) => {
  if (req.body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_e2e', type: 'message', role: 'assistant', content: [], model: req.body.model, usage: { input_tokens: 2, output_tokens: 0 } } })}\n\n`);
    res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '来自' } })}\n\n`);
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Anthropic' } })}\n\n`);
    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
    res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } })}\n\n`);
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    res.end();
    return;
  }
  res.json({
    id: 'msg_e2e', type: 'message', role: 'assistant', model: req.body.model,
    content: [{ type: 'text', text: '来自Anthropic上游' }], stop_reason: 'end_turn',
    usage: { input_tokens: 2, output_tokens: 3 },
  });
});

// Gemini 上游（非流式 + 流式）
upstream.post('/gemini/v1beta/models/*', (req, res) => {
  const isStream = req.originalUrl.includes(':streamGenerateContent');
  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '来自' }], role: 'model' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini' }], role: 'model' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, role: 'model' }], finishReason: 'STOP' })}\n\n`);
    res.end();
    return;
  }
  res.json({
    candidates: [{ content: { parts: [{ text: '来自Gemini上游' }], role: 'model' }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
  });
});

// OpenAI 上游（图片 / 嵌入 / 重排序）
upstream.post('/openai/images/generations', (req, res) => {
  res.json({ created: 1700000000, data: [{ url: 'https://upstream/img1.png' }, { url: 'https://upstream/img2.png' }] });
});
upstream.post('/openai/embeddings', (req, res) => {
  res.json({ object: 'list', data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }], model: 'embed-x', usage: { prompt_tokens: 3, total_tokens: 3 } });
});
upstream.post('/openai/rerank', (req, res) => {
  res.json({ id: 'rerank_e2e', results: [{ index: 0, relevance_score: 0.9, document: 'doc1' }, { index: 1, relevance_score: 0.8, document: 'doc2' }], usage: { total_tokens: 10 } });
});

const server = upstream.listen(18222, async () => {
  console.log('=== 端到端 Transmux 冒烟测试 ===\n');
  const base = 'http://localhost:18222';

  // ===== 非流式 =====
  // 入口 OpenAI -> 上游 Anthropic
  {
    const target: TransmuxTarget = { protocol: 'anthropic', variant: 'messages', url: `${base}/anthropic/messages`, headers: { 'x-api-key': 'k', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, model: 'claude-x' };
    const r = await transmuxCall(target, { body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, entryProtocol: 'openai', entryVariant: 'chat-completions', requestedModel: 'm', stream: false });
    check('OpenAI入口->Anthropic上游: 内容', r.success && r.response.choices[0].message.content === '来自Anthropic上游', JSON.stringify(r));
    check('OpenAI入口->Anthropic上游: usage', r.success && r.response.usage.total_tokens === 5);
  }
  // 入口 Anthropic -> 上游 OpenAI
  {
    const target: TransmuxTarget = { protocol: 'openai', variant: 'chat-completions', url: `${base}/openai/chat/completions`, headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, model: 'gpt-x' };
    const r = await transmuxCall(target, { body: { model: 'm', system: 'sys', messages: [{ role: 'user', content: 'hi' }] }, entryProtocol: 'anthropic', entryVariant: 'messages', requestedModel: 'm', stream: false });
    check('Anthropic入口->OpenAI上游: type=message', r.success && r.response.type === 'message', JSON.stringify(r));
    check('Anthropic入口->OpenAI上游: 内容', r.success && r.response.content[0].text === '来自OpenAI上游');
  }
  // 入口 Gemini -> 上游 OpenAI
  {
    const target: TransmuxTarget = { protocol: 'openai', variant: 'chat-completions', url: `${base}/openai/chat/completions`, headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, model: 'gpt-x' };
    const r = await transmuxCall(target, { body: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }, entryProtocol: 'google', entryVariant: 'generate-content', requestedModel: 'm', stream: false });
    check('Gemini入口->OpenAI上游: 内容', r.success && r.response.candidates[0].content.parts[0].text === '来自OpenAI上游', JSON.stringify(r));
  }

  // ===== 流式 =====
  async function collectStream(target: TransmuxTarget, body: any, entryProtocol: string, entryVariant: string) {
    const chunks: string[] = [];
    class FakeRes extends (require('events').EventEmitter) {
      headers: any = {};
      setHeader(k: string, v: string) { this.headers[k] = v; }
      write(c: string) { chunks.push(c); }
      end() {}
    }
    const fakeRes: any = new FakeRes();
    await transmuxStream(target, { body, entryProtocol: entryProtocol as any, entryVariant, requestedModel: 'm', stream: true }, fakeRes as any);
    // 流事件异步到达，等待事件循环处理完
    await new Promise(r => setTimeout(r, 500));
    return chunks.join('');
  }

  // 入口 OpenAI -> 上游 Gemini 流式
  {
    const target: TransmuxTarget = { protocol: 'google', variant: 'stream-generate-content', url: `${base}/gemini/v1beta/models/x:streamGenerateContent`, headers: { 'Content-Type': 'application/json' }, model: 'g-x' };
    const out = await collectStream(target, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, 'openai', 'chat-completions');
    check('OpenAI入口<-Gemini上游 流式: 内容', out.includes('"content":"来自"') && out.includes('"content":"Gemini"'), out);
    check('OpenAI入口<-Gemini上游 流式: DONE', out.includes('[DONE]'));
  }
  // 入口 Anthropic -> 上游 OpenAI 流式
  {
    const target: TransmuxTarget = { protocol: 'openai', variant: 'chat-completions', url: `${base}/openai/chat/completions`, headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, model: 'gpt-x' };
    const out = await collectStream(target, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, 'anthropic', 'messages');
    check('Anthropic入口<-OpenAI上游 流式: message_start', out.includes('event: message_start'), out);
    check('Anthropic入口<-OpenAI上游 流式: text_delta', out.includes('text_delta') && out.includes('来自'));
    check('Anthropic入口<-OpenAI上游 流式: message_stop', out.includes('message_stop'));
  }
  // 入口 Gemini -> 上游 OpenAI 流式
  {
    const target: TransmuxTarget = { protocol: 'openai', variant: 'chat-completions', url: `${base}/openai/chat/completions`, headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, model: 'gpt-x' };
    const out = await collectStream(target, { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }, 'google', 'stream-generate-content');
    check('Gemini入口<-OpenAI上游 流式: SSE', out.includes('data:') && out.includes('来自'), out);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  server.close();
  process.exit(failed > 0 ? 1 : 0);
});
