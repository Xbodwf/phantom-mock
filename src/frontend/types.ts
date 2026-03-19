export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | MessageContent[];
}

export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stop?: string | string[];
  n?: number;
  user?: string;
}

export interface Model {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  description?: string;
  context_length?: number;
  icon?: string; // 模型图标路径
  
  // 模型分类和标签
  modelType?: string;             // 模型类型（如 chat, image, video, embedding）
  modelSize?: string;             // 模型大小（如 7B, 13B, 70B）
  modelSuffix?: string;           // 模型后缀（如 -instruct, -chat）
  ownerId?: string;               // 归属人ID（用户ID）
  tags?: string[];                // 模型标签
  category?: 'chat' | 'image' | 'video' | 'custom'; // 模型分类
  capabilities?: string[];        // 模型能力列表
  
  aliases?: string[];
  max_output_tokens?: number;
  pricing?: {
    input?: number;
    output?: number;
    unit?: 'K' | 'M';
    type?: 'token' | 'request';
    perRequest?: number;
    cacheRead?: number;
  };
  
  // 速率限制
  rpm?: number;                   // 每分钟请求数限制
  tpm?: number;                   // 每分钟Token数限制
  
  // 并发和队列控制
  maxConcurrentRequests?: number; // 最大同时请求数
  concurrentQueues?: number;      // 同时进行队列数
  allowOveruse?: number;          // 允许超开倍率（0表示不允许）
  
  api_key?: string;
  api_base_url?: string;
  api_type?: 'openai' | 'anthropic' | 'google' | 'azure' | 'custom';
  forwardModelName?: string;      // 转发时使用的模型名称
  supported_features?: string[];
  require_api_key?: boolean;
  allowManualReply?: boolean;     // 是否允许人工回复
  
  // 评价系统
  rating?: {
    positiveCount?: number;
    negativeCount?: number;
    averageScore?: number;
  };
}

// API Key 类型
export interface ApiKey {
  id: string;
  key?: string; // 可选，列表中不返回
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  enabled: boolean;
  viewCount?: number;
  permissions?: {
    models?: string[];
    modelsMode?: 'whitelist' | 'blacklist';
    actions?: string[];
    actionsMode?: 'whitelist' | 'blacklist';
    endpoints?: string[];
  };
}

// 用于更新模型的参数类型（支持修改ID）
export interface ModelUpdateParams extends Partial<Model> {
  newId?: string;
}

// 图片生成请求
export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  response_format?: 'url' | 'b64_json';
  user?: string;
}

// 视频生成请求
export interface VideoGenerationRequest {
  model: string;
  prompt: string;
  size?: string;
  duration?: number;
  aspect_ratio?: string;
  response_format?: 'url' | 'b64_json';
  user?: string;
}

export interface PendingRequest {
  requestId: string;
  request: ChatCompletionRequest;
  isStream: boolean;
  createdAt: number;
  requestParams?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    stop?: string | string[];
    n?: number;
    user?: string;
  };
  requestType?: 'chat' | 'image' | 'video';
  imageRequest?: ImageGenerationRequest;
  videoRequest?: VideoGenerationRequest;
}

export interface WSMessage {
  type: 'request' | 'response' | 'stream' | 'stream_end' | 'connected' | 'models_update';
  payload: {
    requestId: string;
    data: ChatCompletionRequest;
  } | {
    requestId: string;
    content: string;
  } | {
    message: string;
  } | {
    models: Model[];
  };
}

export interface Stats {
  pendingRequests: number;
  connectedClients: number;
  totalModels: number;
}

// Settings 类型
export interface Settings {
  streamDelay: number;
  requireApiKey?: boolean; // 全局是否需要 API Key
  smoothOutput?: boolean; // 平滑输出模式
  smoothSpeed?: number; // 平滑输出速度（字符/秒）
  port?: number; // 服务器端口
  tcpServerEnabled?: boolean; // 是否启用 TCP 服务器
  tcpServerPort?: number; // TCP 服务器端口
  tcpClients?: Array<{
    name: string;
    host: string;
    port: number;
    enabled: boolean;
  }>; // TCP 客户端配置
}

// 导出别名，保持兼容
export type SystemSettings = Settings;
