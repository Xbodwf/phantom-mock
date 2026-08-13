/**
 * Transmux 与现有模型配置系统的接线层。
 *
 * 复用 forwarder.ts 的 URL 解析 / forwarder 的模型目标选择，
 * 把「模型配置 + 入口协议」翻译成 pipeline 需要的上游目标
 * （协议、变体、URL、请求头、上游模型名），并调用 transmux。
 */
import type { Response } from 'express';
import type { Model } from '../types.js';
import axios from 'axios';
import { resolveForwardUrl, getEffectiveApiKey, mergeHeaders } from '../forwarder.js';
import { selectModelTarget, applyModelTarget } from '../forwarding/targets.js';
import type { TransmuxProtocol, TransmuxAdapter } from './types.js';
import { transmuxCall, transmuxStream, type TransmuxTarget } from './pipeline.js';
import { getAdapter } from './registry.js';
import { openaiAdapter as openaiAdapterRef } from './adapters/openai.js';

// 确保 adapter 已注册（避免 getAdapter 在未注册时抛错）
import { registerAdapter } from './registry.js';
registerAdapter(openaiAdapterRef);

function ensureAdapter(adapter: TransmuxAdapter | undefined): TransmuxAdapter {
  return adapter || openaiAdapterRef;
}

/** 入口变体 -> 入口协议 */
export function entryVariantToProtocol(entryVariant: string): TransmuxProtocol {
  if (entryVariant === 'messages') return 'anthropic';
  if (entryVariant === 'generate-content' || entryVariant === 'stream-generate-content') return 'google';
  return 'openai';
}

/**
 * 判断是否应直出（同协议零转换透传）。
 * gemini generate-content -> gemini generate-content、openai chat -> openai chat 等。
 */
export function shouldPassthrough(entryVariant: string, targetProtocol: string, targetVariant: string): boolean {
  const entryProtocol = entryVariantToProtocol(entryVariant);
  if (entryProtocol !== targetProtocol) return false;
  // 流式/非流式同协议间允许直出
  const compatible =
    (targetVariant === 'chat-completions') ||
    (targetVariant === 'responses') ||
    (targetVariant === 'messages') ||
    (targetVariant === 'generate-content') ||
    (targetVariant === 'stream-generate-content');
  return compatible;
}

/** (协议, 变体) -> resolveForwardUrl 使用的 endpoint */
function endpointForTarget(protocol: string, variant: string): 'chat' | 'responses' | 'anthropicMessages' | 'geminiGenerateContent' | 'geminiStreamGenerateContent' | 'geminiEmbedContent' | 'embeddings' | 'rerank' | 'imageGenerations' | 'imageEdits' {
  if (protocol === 'anthropic') return 'anthropicMessages';
  if (protocol === 'google') {
    if (variant === 'embeddings' || variant === 'geminiEmbedContent') return 'geminiEmbedContent';
    return variant === 'stream-generate-content' ? 'geminiStreamGenerateContent' : 'geminiGenerateContent';
  }
  if (variant === 'responses') return 'responses';
  if (variant === 'embeddings') return 'embeddings';
  if (variant === 'rerank') return 'rerank';
  if (variant === 'image-generations') return 'imageGenerations';
  if (variant === 'image-edits') return 'imageEdits';
  return 'chat';
}

function headersForTarget(protocol: string, apiKey: string, model: Model): Record<string, string> {
  const base = { 'Content-Type': 'application/json' };
  if (protocol === 'anthropic') {
    return mergeHeaders(model.defaultHeaders, {
      ...base,
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    });
  }
  if (protocol === 'google') {
    // gemini key 由 resolveForwardUrl 拼在 URL 上
    return mergeHeaders(model.defaultHeaders, base);
  }
  return mergeHeaders(model.defaultHeaders, { ...base, Authorization: `Bearer ${apiKey}` });
}

export interface TransmuxForwardOptions {
  /** 运行时模型（已完成 provider 密钥轮询） */
  model: Model;
  /** 入口变体：chat-completions / responses / messages / generate-content / stream-generate-content */
  entryVariant: string;
  /** 客户端原始请求体 */
  body: any;
  /** 客户端请求的模型名 */
  requestedModel: string;
  stream: boolean;
}

export interface TransmuxForwardResult {
  success: boolean;
  response?: any;
  error?: any;
}

function resolveTarget(model: Model, entryVariant: string, stream: boolean): { target: TransmuxTarget; runtimeModel: Model } | null {
  const selected = selectModelTarget(model, entryVariant as any, stream ? 'stream' : 'request');
  const runtimeModel = applyModelTarget(model, selected.variant as any, stream ? 'stream' : 'request');

  const protocol = (selected.protocol as TransmuxProtocol) ?? 'openai';
  const variant = selected.variant;
  const forwardModel = runtimeModel.forwardModelName || runtimeModel.id || '';

  const endpoint = endpointForTarget(protocol, variant);
  const url = resolveForwardUrl(runtimeModel, endpoint as any, model.id, forwardModel);
  const apiKey = getEffectiveApiKey(runtimeModel);
  const headers = headersForTarget(protocol, apiKey, runtimeModel);

  return {
    target: {
      protocol,
      variant,
      url,
      headers,
      model: forwardModel,
    },
    runtimeModel,
  };
}

/** 非流式转发 */
export async function transmuxForward(opts: TransmuxForwardOptions): Promise<TransmuxForwardResult> {
  const resolved = resolveTarget(opts.model, opts.entryVariant, false);
  if (!resolved) {
    return { success: false, error: { error: { message: 'No valid forwarding target', type: 'forwarding_error', code: 'no_target' } } };
  }
  const { target } = resolved;

  // 同协议直出：零转换，直接透传原始请求体
  if (shouldPassthrough(opts.entryVariant, target.protocol, target.variant)) {
    try {
      const forwardBody = { ...opts.body, model: target.model };
      const response = await axios.post(target.url, forwardBody, {
        headers: target.headers,
        timeout: 120000,
        responseType: 'json',
      });
      return { success: true, response: response.data };
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || error?.message || 'Unknown error';
      return { success: false, error: { error: { message: msg, type: 'api_error', code: 'forwarding_failed' } } };
    }
  }

  try {
    const result = await transmuxCall(target, {
      body: opts.body,
      entryProtocol: entryVariantToProtocol(opts.entryVariant),
      entryVariant: opts.entryVariant,
      requestedModel: opts.requestedModel,
      stream: false,
    });
    if (!result.success) return { success: false, error: result.error };
    return { success: true, response: result.response };
  } catch (error: any) {
    return {
      success: false,
      error: { error: { message: error?.message ?? 'Unknown error', type: 'api_error', code: 'transmux_failed' } },
    };
  }
}

/** 流式转发；失败时返回 false（不写响应，由路由决定人工回复回退） */
export async function transmuxForwardStream(
  opts: TransmuxForwardOptions,
  res: Response,
  onStreamData?: (info: { content: string; reasoningContent?: string | null }) => void,
): Promise<boolean> {
  const resolved = resolveTarget(opts.model, opts.entryVariant, true);
  if (!resolved) return false;
  const { target } = resolved;

  // 同协议直出：SSE 流直接透传
  if (shouldPassthrough(opts.entryVariant, target.protocol, target.variant)) {
    return passthroughStream(target, { ...opts.body, model: target.model }, res, onStreamData);
  }

  try {
    await transmuxStream(target, {
      body: opts.body,
      entryProtocol: entryVariantToProtocol(opts.entryVariant),
      entryVariant: opts.entryVariant,
      requestedModel: opts.requestedModel,
      stream: true,
    }, res, onStreamData);
    return true;
  } catch (error: any) {
    console.error('[Transmux] stream forward failed:', error?.message);
    return false;
  }
}

/** 直出流式透传：原样转发上游 SSE 到客户端 */
async function passthroughStream(
  target: TransmuxTarget,
  forwardBody: any,
  res: Response,
  onStreamData?: (info: { content: string; reasoningContent?: string | null }) => void,
): Promise<boolean> {
  try {
    const response = await axios.post(target.url, forwardBody, {
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
      response.data?.destroy?.();
    });

    response.data.on('data', (chunk: Buffer) => {
      if (clientClosed) return;
      res.write(chunk);
    });
    response.data.on('end', () => {
      if (!clientClosed) res.end();
    });
    response.data.on('error', (err: Error) => {
      console.error('[Transmux] passthrough stream error:', err.message);
      if (!clientClosed) res.end();
    });
    return true;
  } catch (error: any) {
    console.error('[Transmux] passthrough stream failed:', error?.message);
    return false;
  }
}

// ==================== 图片 / 嵌入 / 重排序 转发 ====================

export interface TransmuxMediaForwardOptions {
  model: Model;
  entryVariant: string;
  body: any;
  requestedModel: string;
  /** 图片编辑的 multipart 文件 */
  files?: Express.Multer.File[];
}

export interface TransmuxMediaResult {
  success: boolean;
  response?: any;
  error?: any;
}

function resolveTargetOrNull(model: Model, entryVariant: string, stream: boolean) {
  return resolveTarget(model, entryVariant, stream);
}

/** 图片生成/编辑转发 */
export async function transmuxImageForward(opts: TransmuxMediaForwardOptions): Promise<TransmuxMediaResult> {
  const resolved = resolveTargetOrNull(opts.model, opts.entryVariant, false);
  if (!resolved) return { success: false, error: { error: { message: 'No valid forwarding target', type: 'forwarding_error', code: 'no_target' } } };
  const { target } = resolved;
  const entryAdapter = getAdapter(entryVariantToProtocol(opts.entryVariant));
  const upstreamAdapter = getAdapter(target.protocol as TransmuxProtocol);

  try {
    const parseImage = entryAdapter.parseImageRequest || openaiAdapterRef.parseImageRequest!;
    const toImage = upstreamAdapter.toImageRequest || openaiAdapterRef.toImageRequest!;
    const fromImage = upstreamAdapter.fromImageResponse || openaiAdapterRef.fromImageResponse!;
    const serializeImage = entryAdapter.serializeImageResponse || openaiAdapterRef.serializeImageResponse!;

    const ir = parseImage(opts.body, { requestedModel: opts.requestedModel, forwardModel: target.model });
    const isEdit = opts.entryVariant === 'image-edits';

    let response;
    if (isEdit && opts.files && opts.files.length > 0) {
      const { readFileSync } = await import('fs');
      const form = new FormData();
      const upstreamBody = toImage(ir);
      form.append('prompt', ir.prompt);
      form.append('model', target.model);
      if (ir.n) form.append('n', String(ir.n));
      if (ir.size) form.append('size', ir.size);
      if (ir.response_format) form.append('response_format', ir.response_format);
      for (const f of opts.files) {
        const fileBuffer = readFileSync(f.path);
        const fieldName = f.fieldname || 'image';
        form.append(fieldName, new Blob([fileBuffer], { type: f.mimetype || 'image/png' } as BlobPropertyBag), f.originalname);
      }
      response = await axios.post(target.url, form, {
        headers: { Authorization: target.headers.Authorization },
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } else {
      const upstreamBody = toImage(ir);
      response = await axios.post(target.url, upstreamBody, {
        headers: target.headers,
        timeout: 120000,
      });
    }

    const irResponse = fromImage(response.data, opts.requestedModel);
    const serialized = serializeImage(irResponse, opts.requestedModel);
    return { success: true, response: serialized };
  } catch (error: any) {
    const msg = error?.response?.data?.error?.message || error?.message || 'Unknown error';
    return { success: false, error: { error: { message: msg, type: 'api_error', code: 'transmux_image_failed' } } };
  }
}

/** 嵌入转发 */
export async function transmuxEmbeddingForward(opts: TransmuxMediaForwardOptions): Promise<TransmuxMediaResult> {
  const resolved = resolveTargetOrNull(opts.model, opts.entryVariant, false);
  if (!resolved) return { success: false, error: { error: { message: 'No valid forwarding target', type: 'forwarding_error', code: 'no_target' } } };
  const { target } = resolved;
  const entryAdapter = getAdapter(entryVariantToProtocol(opts.entryVariant));
  const upstreamAdapter = getAdapter(target.protocol as TransmuxProtocol);

  try {
    const parse = entryAdapter.parseEmbeddingRequest || openaiAdapterRef.parseEmbeddingRequest!;
    const to = upstreamAdapter.toEmbeddingRequest || openaiAdapterRef.toEmbeddingRequest!;
    const from = upstreamAdapter.fromEmbeddingResponse || openaiAdapterRef.fromEmbeddingResponse!;
    const serialize = entryAdapter.serializeEmbeddingResponse || openaiAdapterRef.serializeEmbeddingResponse!;

    const ir = parse(opts.body, { requestedModel: opts.requestedModel, forwardModel: target.model });
    const upstreamBody = to(ir);
    const response = await axios.post(target.url, upstreamBody, { headers: target.headers, timeout: 120000 });
    const irResponse = from(response.data, opts.requestedModel);
    return { success: true, response: serialize(irResponse, opts.requestedModel) };
  } catch (error: any) {
    const msg = error?.response?.data?.error?.message || error?.message || 'Unknown error';
    return { success: false, error: { error: { message: msg, type: 'api_error', code: 'transmux_embedding_failed' } } };
  }
}

/** 重排序转发 */
export async function transmuxRerankForward(opts: TransmuxMediaForwardOptions): Promise<TransmuxMediaResult> {
  const resolved = resolveTargetOrNull(opts.model, opts.entryVariant, false);
  if (!resolved) return { success: false, error: { error: { message: 'No valid forwarding target', type: 'forwarding_error', code: 'no_target' } } };
  const { target } = resolved;
  const entryAdapter = getAdapter(entryVariantToProtocol(opts.entryVariant));
  const upstreamAdapter = getAdapter(target.protocol as TransmuxProtocol);

  try {
    const parse = entryAdapter.parseRerankRequest || openaiAdapterRef.parseRerankRequest!;
    const to = upstreamAdapter.toRerankRequest || openaiAdapterRef.toRerankRequest!;
    const from = upstreamAdapter.fromRerankResponse || openaiAdapterRef.fromRerankResponse!;
    const serialize = entryAdapter.serializeRerankResponse || openaiAdapterRef.serializeRerankResponse!;

    const ir = parse(opts.body, { requestedModel: opts.requestedModel, forwardModel: target.model });
    const upstreamBody = to(ir);
    const response = await axios.post(target.url, upstreamBody, { headers: target.headers, timeout: 60000 });
    const irResponse = from(response.data, opts.requestedModel);
    return { success: true, response: serialize(irResponse, opts.requestedModel) };
  } catch (error: any) {
    const msg = error?.response?.data?.error?.message || error?.message || 'Unknown error';
    return { success: false, error: { error: { message: msg, type: 'api_error', code: 'transmux_rerank_failed' } } };
  }
}
