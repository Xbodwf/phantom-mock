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
    unit?: 'K' | 'M'; // 价格单位（K=千，M=百万）
    type?: 'token' | 'request'; // 计费类型：按 token 或按请求
    perRequest?: number; // 按请求计费时的单价（美元）
  };
  api_key?: string; // 模型关联的API密钥（用于转发）
  api_base_url?: string; // API基础URL（用于转发）
  api_type?: 'openai' | 'anthropic' | 'google' | 'azure' | 'custom'; // API接口类型（用于转发）
  supported_features?: string[]; // 支持的特性，如 ['chat', 'vision', 'function_calling']
  require_api_key?: boolean; // 是否需要API Key才能访问（默认true）
  // 组合模型字段
  isComposite?: boolean;           // 是否为组合模型
  actions?: string[];              // Action IDs 列表
  actionChain?: Array<{
    actionId: string;
    paramMapping?: Record<string, string>;  // 参数映射
    condition?: string;             // 执行条件
  }>;
  createdBy?: string;              // 用户自定义模型的创建者
  isPublic?: boolean;              // 是否公开
  tags?: string[];                 // 模型标签
  category?: 'chat' | 'image' | 'video' | 'custom'; // 模型分类
}

// API Key 定义
export interface ApiKey {
  id: string;
  key: string;
  name: string;
  userId?: string;                 // 关联用户 ID（新增）
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;              // 过期时间（新增）
  enabled: boolean;
  viewCount?: number;              // 查看次数（新增）
  // 权限配置
  permissions?: {
    models?: string[]; // 允许访问的模型列表，空数组表示所有模型
    modelsMode?: 'whitelist' | 'blacklist'; // 模型访问模式：白名单或黑名单
    actions?: string[]; // 允许访问的 Action 列表
    actionsMode?: 'whitelist' | 'blacklist'; // Action 访问模式：白名单或黑名单
    endpoints?: string[]; // 允许访问的端点类型 ['chat', 'image', 'video', 'embeddings']
    rateLimit?: number;            // 每分钟请求数限制（新增）
  };
}

// 用户定义
export interface User {
  id: string;                      // UUID
  username: string;                // 唯一用户名
  email: string;                   // 唯一邮箱
  passwordHash: string;            // bcrypt 哈希密码
  balance: number;                 // 账户余额（美元）
  totalUsage: number;              // 总 token 使用量
  createdAt: number;               // 创建时间
  lastLoginAt?: number;            // 最后登录时间
  enabled: boolean;                // 账户是否启用
  role: 'user' | 'admin';          // 用户角色
  settings?: {
    emailNotifications?: boolean;  // 邮件通知
    apiKeyExpiry?: number;         // API Key 过期时间（天）
    theme?: ThemeConfig;           // 用户主题偏好
  };
}

// 使用记录
export interface UsageRecord {
  id: string;
  userId: string;
  apiKeyId: string;
  model: string;
  endpoint: string;               // 'chat', 'image', 'video'
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;                   // 美元
  timestamp: number;
  requestId: string;
}

// 账单
export interface Invoice {
  id: string;
  userId: string;
  period: string;                 // 'YYYY-MM'
  totalUsage: number;             // 总 token 数
  totalCost: number;              // 总费用
  status: 'pending' | 'paid' | 'overdue';
  createdAt: number;
  dueDate: number;
}

// Action 定义（自定义 Action）
export interface Action {
  id: string;
  name: string;
  description: string;
  code: string;                   // TypeScript 代码
  createdBy: string;              // 创建者 userId
  createdAt: number;
  updatedAt: number;
  version: number;
  isPublic: boolean;              // 是否公开
  permissions?: {
    allowedUsers?: string[];      // 允许使用的用户
    allowedModels?: string[];     // 允许被哪些模型使用
  };
  parameters?: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object';
    required: boolean;
    description?: string;
  }>;
  returnType?: 'string' | 'object' | 'stream';
  tags?: string[];
  rating?: number;                // 用户评分
  usageCount?: number;            // 使用次数
}

// 内置 Action 定义
export interface ActionDefinition {
  id: string;                     // 唯一标识，如 'phantom/call-model'
  name: string;                   // 显示名称
  description: string;            // 描述
  version: string;                // 版本号
  author: string;                 // 作者

  // 输入参数定义
  inputs: {
    [key: string]: {
      description: string;
      required: boolean;
      default?: any;
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      enum?: any[];                // 可选值列表
    };
  };

  // 输出定义
  outputs: {
    [key: string]: {
      description: string;
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    };
  };

  // 元数据
  tags?: string[];
  category?: 'model' | 'transform' | 'storage' | 'notification' | 'custom';
}

// 工作流步骤定义
export interface WorkflowStep {
  id: string;                     // 步骤 ID，如 'step1'
  name: string;                   // 显示名称
  uses: string;                   // 使用的 Action，如 'phantom/call-model@v1'

  // 输入参数
  with?: {
    [key: string]: any;
  };

  // 条件执行
  if?: string;                    // 条件表达式

  // 循环
  foreach?: {
    items: string;                // 数组表达式
    variable: string;             // 循环变量名
  };

  // 并行执行
  parallel?: boolean;

  // 错误处理
  continueOnError?: boolean;
  timeout?: number;               // 超时时间（秒）

  // 重试
  retry?: {
    maxAttempts: number;
    delay: number;                // 延迟时间（毫秒）
  };
}

// 工作流定义
export interface Workflow {
  id: string;
  name: string;
  description: string;
  version: string;

  // 工作流触发条件
  triggers?: {
    manual?: boolean;             // 手动触发
    schedule?: string;            // Cron 表达式
    webhook?: {
      path: string;
      events?: string[];
    };
  };

  // 输入参数
  inputs?: {
    [key: string]: {
      description: string;
      required: boolean;
      default?: any;
      type: string;
    };
  };

  // 环境变量
  env?: {
    [key: string]: string;
  };

  // 工作流步骤
  steps: WorkflowStep[];

  // 输出
  outputs?: {
    [key: string]: {
      description: string;
      value: string;               // 引用某个 step 的输出
    };
  };

  // 元数据
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
  tags?: string[];
}

// 步骤执行记录
export interface StepRun {
  id: string;
  stepId: string;
  status: 'pending' | 'running' | 'success' | 'failure' | 'skipped';

  // 输入和输出
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;

  // 时间戳
  startedAt: number;
  completedAt?: number;
  duration?: number;

  // 日志
  logs?: string;

  // 错误
  error?: {
    message: string;
    code?: string;
  };
}

// 工作流运行记录
export interface WorkflowRun {
  id: string;
  workflowId: string;
  userId: string;

  // 执行状态
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';

  // 输入和输出
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;

  // 步骤执行记录
  stepRuns: StepRun[];

  // 时间戳
  startedAt: number;
  completedAt?: number;
  duration?: number;

  // 日志
  logs?: string;

  // 错误信息
  error?: {
    message: string;
    stepId?: string;
    code?: string;
  };
}

// 主题配置
export interface ThemeConfig {
  mode: 'light' | 'dark';
  primaryColor: string;           // 主色调
  secondaryColor: string;         // 辅助色
  accentColor: string;            // 强调色
  customCSS?: string;             // 自定义 CSS
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
  port?: number; // HTTP 服务器端口
  tcpServerEnabled?: boolean; // 是否启用 TCP 服务器
  tcpServerPort?: number; // TCP 服务器端口
  tcpClients?: Array<{
    name: string;
    host: string;
    port: number;
    enabled: boolean;
  }>; // TCP 客户端配置
  // 邮箱验证配置
  emailVerificationEnabled?: boolean; // 是否启用邮箱验证（默认false）
  emailjs?: {
    serviceId: string; // EmailJS Service ID
    templateId: string; // EmailJS Template ID
    publicKey: string; // EmailJS Public Key
    privateKey: string; // EmailJS Private Key
  };
}
