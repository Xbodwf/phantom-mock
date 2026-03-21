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
  icon?: string; // 模型图标路径（相对于 /static/models/）
  
  // 模型分类和标签
  modelType?: string;             // 模型类型（如 chat, image, video, embedding）
  modelSize?: string;             // 模型大小（如 7B, 13B, 70B）
  modelSuffix?: string;           // 模型后缀（如 -instruct, -chat）
  ownerId?: string;               // 归属人ID（用户ID）
  tags?: string[];                // 模型标签（用于标记类型，如专属机房等）
  category?: 'chat' | 'image' | 'video' | 'custom'; // 模型分类
  capabilities?: string[];        // 模型能力列表
  
  // 新增字段
  aliases?: string[]; // 模型别名列表
  max_output_tokens?: number; // 最大输出token数
  pricing?: {
    input?: number; // 输入每1K token价格（美元）
    output?: number; // 输出每1K token价格（美元）
    unit?: 'K' | 'M'; // 价格单位（K=千，M=百万）
    type?: 'token' | 'request'; // 计费类型：按 token 或按请求
    perRequest?: number; // 按请求计费时的单价（美元）
    cacheRead?: number; // 缓存读取价格（美元）
  };
  
  // 速率限制
  rpm?: number;                   // 每分钟请求数限制 (Requests Per Minute)
  tpm?: number;                   // 每分钟Token数限制 (Tokens Per Minute)
  
  // 并发和队列控制
  maxConcurrentRequests?: number; // 最大同时请求数
  concurrentQueues?: number;      // 同时进行队列数（可同时服务多少用户）
  allowOveruse?: number;          // 允许超开倍率（0为不允许，1往上则为最大同时请求数*倍率）
  
  // API 配置
  api_key?: string; // 模型关联的API密钥（用于转发）
  api_base_url?: string; // API基础URL（用于转发）
  api_type?: 'openai' | 'anthropic' | 'google' | 'azure' | 'custom'; // API接口类型（用于转发）
  forwardModelName?: string; // 转发时使用的模型名称（不同平台模型名称可能不同）
  supported_features?: string[]; // 支持的特性，如 ['chat', 'vision', 'function_calling']
  require_api_key?: boolean; // 是否需要API Key才能访问（默认true）
  allowManualReply?: boolean; // 是否允许人工回复（允许的模型才会在请求列表中显示）
  
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
  
  // 评价系统
  rating?: {
    positiveCount?: number;        // 好评数量
    negativeCount?: number;        // 差评数量
    averageScore?: number;         // 平均评分 (0-5)
    ratings?: Map<string, number>; // 评价详情 (userId -> score)
  };
  
  // 举报信息
  reports?: Array<{
    userId: string;
    reason: string;
    timestamp: number;
    status: 'pending' | 'reviewed' | 'resolved';
  }>;
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
  uid?: string;                    // 用户UID（@username风格，唯一，仅允许字母数字下划线）
  passwordHash: string;            // bcrypt 哈希密码

  // 余额和使用
  balance: number;                 // 账户余额（美元）
  totalUsage: number;              // 总 token 使用量

  // 权限和角色
  role: 'user' | 'admin';          // 用户角色
  permissionLevel?: number;        // 权限等级（数字越大权限越高，默认普通用户为0，管理员为100）

  // 邀请系统相关
  inviteCode?: string;             // 用户的邀请码
  invitedBy?: string;              // 邀请人 ID
  extraInviteQuota?: number;       // 额外购买的邀请次数

  // 用户拥有的资源
  ownedModels?: string[];          // 自属模型ID列表
  actions?: string[];              // 用户创建的 Actions

  // 实名信息（可选）
  realName?: string;               // 身份证名字
  idCardNumber?: string;           // 身份证ID

  // 时间戳
  createdAt: number;               // 创建时间
  lastLoginAt?: number;            // 最后登录时间
  enabled: boolean;                // 账户是否启用

  // 用户设置
  settings?: {
    emailNotifications?: boolean;  // 邮件通知
    apiKeyExpiry?: number;         // API Key 过期时间（天）
    theme?: ThemeConfig;           // 用户主题偏好
  };
}

// 邀请记录
export interface InvitationRecord {
  id: string;
  inviterId: string;               // 邀请人 ID
  inviteeId: string;               // 被邀请人 ID
  inviteCode: string;              // 使用的邀请码
  createdAt: number;               // 邀请时间
}

// 站内通知
export interface Notification {
  id: string;
  title: string;                   // 通知标题
  content: string;                 // 通知内容 (Markdown 格式)
  createdAt: number;               // 创建时间
  updatedAt?: number;              // 更新时间
  createdBy: string;               // 创建者 ID
  isPinned?: boolean;              // 是否置顶
  isActive?: boolean;              // 是否启用
}

// 使用记录
export interface UsageRecord {
  id: string;
  userId: string;
  apiKeyId: string;
  model: string;
  modelId?: string;                // 模型ID
  endpoint: string;               // 'chat', 'image', 'video'
  
  // 请求和响应内容
  requestContent?: string;         // 请求内容
  responseContent?: string;        // 生成结果
  response?: string;               // 模型生成的主要文本内容
  message?: string;                // 聊天消息对象内容
  
  // Token 统计
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  
  // 费用
  cost: number;                   // 美元
  balanceAfter?: number;          // 扣费后余额
  
  // 时间戳
  timestamp: number;
  requestId: string;
  createdAt?: number;             // 响应创建时间
  
  // 性能指标
  totalDuration?: number;         // 生成整个响应的总耗时（纳秒）
  loadDuration?: number;          // 加载模型耗时（纳秒）
  promptEvalCount?: number;       // 输入提示评估的token数量
  promptEvalDuration?: number;    // 评估输入提示所花费的时间（纳秒）
  evalCount?: number;             // 模型生成的token数量
  evalDuration?: number;          // 生成token所花费的时间（纳秒）
  
  // 完成原因
  doneReason?: 'stop' | 'length' | 'cancel'; // 生成停止的原因
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

// Rerank API Types
export interface RerankRequest {
  model: string;
  query: string;
  documents: string[];
  top_n?: number;
  return_documents?: boolean;
  max_chunks_per_doc?: number;
}

export interface RerankResult {
  index: number;
  relevance_score: number;
  document?: string;
}

export interface RerankResponse {
  id: string;
  results: RerankResult[];
  model: string;
  usage: {
    total_tokens: number;
    prompt_tokens?: number;
  };
}
