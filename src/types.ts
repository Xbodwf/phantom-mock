// OpenAI API Types

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | MessageContent[];
  name?: string;
  tool_call_id?: string;
}

// 多模态消息内容
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
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: Message;
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: 'stop' | 'length' | null;
  }>;
}

export interface Model {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  description?: string;
  context_length?: number;
  // 新增字段
  aliases?: string[]; // 模型别名列表
  max_output_tokens?: number; // 最大输出token数
  pricing?: {
    input?: number; // 输入每1K token价格（美元）
    output?: number; // 输出每1K token价格（美元）
  };
  api_key?: string; // 模型关联的API密钥（用于转发）
  api_base_url?: string; // API基础URL（用于转发）
  supported_features?: string[]; // 支持的特性，如 ['chat', 'vision', 'function_calling']
  require_api_key?: boolean; // 是否需要API Key才能访问（默认true）
}

// API Key 定义
export interface ApiKey {
  id: string;
  key: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  enabled: boolean;
  // 权限配置
  permissions?: {
    models?: string[]; // 允许访问的模型列表，空数组表示所有模型
    endpoints?: string[]; // 允许访问的端点类型 ['chat', 'image', 'video', 'embeddings']
  };
}

export interface ModelsResponse {
  object: 'list';
  data: Model[];
}

// WebSocket 消息类型
export interface WSMessage {
  type: 'request' | 'response' | 'stream' | 'stream_end' | 'connected' | 'models_update' | 'image_response' | 'video_response';
  payload: {
    requestId: string;
    data: ChatCompletionRequest;
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
  } | {
    requestId: string;
    content: string;
  } | {
    requestId: string;
    images: Array<{ url?: string; b64_json?: string }>;
  } | {
    requestId: string;
    videos: Array<{ url?: string; b64_json?: string }>;
  } | {
    message: string;
  } | {
    models: Model[];
  };
}

// 待处理的请求
export interface PendingRequest {
  requestId: string;
  request: ChatCompletionRequest;
  resolve: (content: string) => void;
  streamController?: {
    enqueue: (chunk: string) => void;
    close: () => void;
  };
  isStream: boolean;
  createdAt: number;
  // 请求元数据
  requestHeaders?: Record<string, string>;
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
  // 请求类型
  requestType?: 'chat' | 'image' | 'video';
  // 图片/视频请求特有参数
  imageRequest?: ImageGenerationRequest;
  videoRequest?: VideoGenerationRequest;
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

// 图片生成响应
export interface ImageGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
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

// 视频生成响应
export interface VideoGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
  }>;
}

// 系统设置
export interface SystemSettings {
  streamDelay: number; // 流式响应延迟时间（毫秒）
  requireApiKey?: boolean; // 全局是否需要API Key（默认false）
  smoothOutput?: boolean; // 平滑输出模式（默认false）
  smoothSpeed?: number; // 平滑输出速度，字符/秒（默认20）
}
