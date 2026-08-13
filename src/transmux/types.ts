/**
 * Transmux 中间表示（IR）
 *
 * 所有协议的请求/响应/流式事件都被归一化为这份 IR，
 * 由协议适配器在「客户端协议」与「上游协议」之间双向翻译。
 *
 * 转换方向（一份适配器双向服务）：
 *   parseRequest        : 入口协议 body -> IRRequest
 *   toRequest           : IRRequest -> 上游协议 body
 *   fromResponse        : 上游非流式响应 -> IRResponse
 *   fromStreamEvent     : 上游流式 SSE payload -> IRStreamEvent[]
 *   serializeResponse   : IRResponse -> 入口协议非流式响应
 *   serializeStreamEvent: IRStreamEvent -> 入口协议 SSE 文本
 */

export type TransmuxProtocol = 'openai' | 'anthropic' | 'google';

// ==================== 消息 ====================

export interface IRTextPart {
  type: 'text';
  text: string;
}

export interface IRImagePart {
  type: 'image';
  /** 图片 URL（http/https） */
  url?: string;
  /** base64 数据 */
  data?: string;
  /** MIME 类型，如 image/png */
  media_type?: string;
}

export interface IRToolCallPart {
  type: 'tool-call';
  /** 工具调用 ID（用于后续 tool 角色消息回传） */
  id?: string;
  name: string;
  /** 参数 JSON 字符串 */
  arguments: string;
}

export interface IRToolResultPart {
  type: 'tool-result';
  /** 关联的 tool-call id */
  tool_call_id?: string;
  name?: string;
  content: string;
}

export type IRMessagePart =
  | IRTextPart
  | IRImagePart
  | IRToolCallPart
  | IRToolResultPart;

export interface IRMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 纯文本内容（text-only 消息） */
  content?: string;
  /** 结构化内容（多模态/工具调用） */
  parts?: IRMessagePart[];
}

// ==================== 工具 ====================

export interface IRTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    /** JSON Schema */
    parameters?: Record<string, unknown>;
    strict?: boolean;
    /** Gemini 3 系列的 thought signature（透传，避免空值） */
    thought_signature?: string;
  };
}

export type IRToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } };

// ==================== 生成参数 ====================

export interface IRGenerationParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  response_format?: unknown;
  /** Anthropic thinking / reasoning 参数 */
  thinking?: { type?: string; budget_tokens?: number };
  /** 透传的额外参数 */
  extra?: Record<string, unknown>;
}

// ==================== 请求 ====================

export interface IRRequest {
  /** 客户端请求的模型名（用于响应回显） */
  model: string;
  /** 上游实际使用的模型名 */
  forwardModel: string;
  messages: IRMessage[];
  tools?: IRTool[];
  tool_choice?: IRToolChoice;
  params: IRGenerationParams;
  stream: boolean;
}

// ==================== 响应 ====================

export interface IRUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens?: number;
}

export interface IRToolCall {
  index?: number;
  id?: string;
  name: string;
  /** 参数 JSON 字符串 */
  arguments: string;
  /** 附加内容（如 Gemini thought_signature） */
  extra_content?: unknown;
}

export interface IRResponse {
  id: string;
  /** 请求时使用的模型名（入口协议回显用） */
  model: string;
  content: string;
  role?: string;
  tool_calls?: IRToolCall[];
  finish_reason?: string | null;
  usage?: IRUsage;
}

// ==================== 流式事件 ====================

export type IRStreamEvent =
  | { type: 'start'; id: string; model: string }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool-call';
      index: number;
      id?: string;
      name?: string;
      /** 增量参数片段 */
      arguments?: string;
    }
  | { type: 'usage'; usage: IRUsage; finish_reason?: string | null }
  | { type: 'done'; finish_reason: string | null }
  | { type: 'error'; message: string; code?: string };

// ==================== 图片 / 嵌入 / 重排序 ====================

export interface IRImageRequest {
  /** 客户端请求的模型名 */
  model: string;
  /** 上游模型名 */
  forwardModel: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  style?: string;
  response_format?: 'url' | 'b64_json';
  /** 编辑用的参考图（base64 data + mime） */
  reference_images?: Array<{ data: string; mime_type?: string }>;
}

export interface IRImageResult {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface IRImageResponse {
  created: number;
  data: IRImageResult[];
}

export interface IREmbeddingRequest {
  model: string;
  forwardModel: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
  /** 上游模型名用于响应回显 */
}

export interface IREmbeddingItem {
  index: number;
  embedding: number[];
  object: 'embedding';
}

export interface IREmbeddingResponse {
  object: 'list';
  data: IREmbeddingItem[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

export interface IRRerankRequest {
  model: string;
  forwardModel: string;
  query: string;
  documents: string[];
  top_n?: number;
  return_documents?: boolean;
  max_chunks_per_doc?: number;
}

export interface IRRerankResult {
  index: number;
  relevance_score: number;
  document?: string;
}

export interface IRRerankResponse {
  id: string;
  results: IRRerankResult[];
  model: string;
  usage: { total_tokens: number; prompt_tokens?: number };
}

export interface IRImageRequestContext {
  requestedModel: string;
  forwardModel: string;
}

// ==================== 适配器 ====================

export interface AdapterContext {
  protocol: TransmuxProtocol;
  /** 上游变体：chat-completions / messages / generate-content / stream-generate-content ... */
  variant: string;
  model: string;
  stream: boolean;
}

/** 上游流式解析的跨 chunk 状态（由 createStreamState 初始化） */
export interface StreamState {
  /** 已发送的内容块（Anthropic 需要 index 追踪） */
  contentBlockIndex: number;
  /** 当前工具调用累积参数（Anthropic input_json_delta） */
  toolArgs: Record<number, string>;
  toolNames: Record<number, string>;
  toolIds: Record<number, string>;
  [key: string]: unknown;
}

/** 入口协议流式序列化的跨事件状态 */
export interface EntryStreamState {
  started: boolean;
  contentBlockStarted: boolean;
  contentBlockIndex: number;
  [key: string]: unknown;
}

/** 一个协议适配器，双向服务：既是上游目标转换器，也是入口解析/序列化器 */
export interface TransmuxAdapter {
  protocol: TransmuxProtocol;
  /** 该协议支持的上游变体 */
  variants: readonly string[];

  // ---------- 入口：客户端协议 body -> IR ----------
  parseRequest(
    body: any,
    ctx: {
      requestedModel: string;
      forwardModel: string;
      stream: boolean;
      variant?: string;
    }
  ): IRRequest;

  // ---------- 上游：IR -> 上游协议 body ----------
  toRequest(ir: IRRequest, ctx?: { variant?: string }): unknown;

  // ---------- 上游：非流式响应 -> IR ----------
  fromResponse(body: unknown, ctx: AdapterContext): IRResponse;

  // ---------- 上游：流式 SSE payload -> IR 事件 ----------
  createStreamState(): StreamState;
  fromStreamEvent(
    payload: any,
    state: StreamState,
    ctx: AdapterContext
  ): IRStreamEvent[];

  // ---------- 入口：IR -> 客户端协议非流式响应 ----------
  serializeResponse(ir: IRResponse, requestedModel: string, variant?: string): unknown;

  // ---------- 入口：IR 流事件 -> 客户端 SSE 文本 ----------
  createEntryState(): EntryStreamState;
  serializeStreamEvent(
    evt: IRStreamEvent,
    requestedModel: string,
    state: EntryStreamState,
    variant?: string
  ): string | null;
  /** 入口协议的流结束标记（如 OpenAI 的 data: [DONE]；Anthropic 无、Gemini 无） */
  streamDone(): string;

  // ---------- 可选：图片生成 ----------
  toImageRequest?(ir: IRImageRequest): unknown;
  fromImageResponse?(body: unknown, requestedModel: string): IRImageResponse;
  parseImageRequest?(body: any, ctx: IRImageRequestContext): IRImageRequest;
  serializeImageResponse?(ir: IRImageResponse, requestedModel: string): unknown;

  // ---------- 可选：嵌入 ----------
  toEmbeddingRequest?(ir: IREmbeddingRequest): unknown;
  fromEmbeddingResponse?(body: unknown, requestedModel: string): IREmbeddingResponse;
  parseEmbeddingRequest?(body: any, ctx: IRImageRequestContext): IREmbeddingRequest;
  serializeEmbeddingResponse?(ir: IREmbeddingResponse, requestedModel: string): unknown;

  // ---------- 可选：重排序 ----------
  toRerankRequest?(ir: IRRerankRequest): unknown;
  fromRerankResponse?(body: unknown, requestedModel: string): IRRerankResponse;
  parseRerankRequest?(body: any, ctx: IRImageRequestContext): IRRerankRequest;
  serializeRerankResponse?(ir: IRRerankResponse, requestedModel: string): unknown;
}
