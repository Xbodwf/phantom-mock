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
  aliases?: string[];
  max_output_tokens?: number;
  pricing?: {
    input?: number;
    output?: number;
  };
  api_key?: string;
  api_base_url?: string;
  supported_features?: string[];
  require_api_key?: boolean; // 是否需要 API Key 才能访问
}

// API Key 类型
export interface ApiKey {
  id: string;
  key: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  enabled: boolean;
  permissions?: {
    models?: string[];
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
}

// 导出别名，保持兼容
export type SystemSettings = Settings;
