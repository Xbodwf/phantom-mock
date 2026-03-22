# Phantom Mock

一个 AI 接口服务器，支持 OpenAI/Gemini/Anthropic 等主流接口。

## 功能特性

- 轻量、即开即用
- 支持多种 AI API 格式：OpenAI、Anthropic、Google Gemini
- 支持模型转发、人工回复
- WebSocket 实时请求推送
- 用户系统与 API Key 管理
- Action 系统（自定义脚本）
- Workflow 工作流

## 部署方式

### 方式一：Docker Compose 单独部署（推荐快速体验）

适合快速体验，使用 JSON 文件存储数据。

```bash
# 克隆仓库
git clone https://github.com/Xbodwf/phantom-mock.git
cd phantom-mock

# 创建必要的目录
mkdir -p data static/models

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f phantom-mock
```

服务将在 `http://localhost:7143` 启动。

### 方式二：Docker Compose 与 MongoDB 一起部署

适合生产环境，使用 MongoDB 存储数据，支持更好的扩展性。

1. 编辑 `docker-compose.yml`，取消 MongoDB 相关配置的注释：

```yaml
services:
  phantom-mock:
    # ... 其他配置 ...
    environment:
      - NODE_ENV=production
      - PORT=7143
      - MONGODB_URI=mongodb://mongodb:27017/phantom-mock  # 取消注释
    depends_on:
      - mongodb  # 取消注释

  mongodb:
    image: mongo:7
    container_name: phantom-mock-mongodb
    restart: unless-stopped
    volumes:
      - mongodb_data:/data/db
    ports:
      - "27017:27017"  # MongoDB 端口对外开放
    environment:
      - MONGO_INITDB_DATABASE=phantom-mock

volumes:
  mongodb_data:
```

2. 启动服务：

```bash
# 创建必要的目录
mkdir -p data static/models

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

服务说明：
- 应用服务：`http://localhost:7143`
- MongoDB 服务：`localhost:27017`（可用于数据迁移、备份等）

### 方式三：通过镜像拉取

```bash
# 创建目录
mkdir -p data static/models

# 运行容器
docker run -d \
  --name phantom-mock \
  -p 7143:7143 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/static:/app/static \
  xbodwf/phantom-mock:latest
```

### 方式四：Docker 手动构建

```bash
# 创建目录
mkdir -p data static/models

# 构建镜像
docker build --no-cache -t phantom-mock .

# 运行容器
docker run -d \
  --name phantom-mock \
  -p 7143:7143 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/static:/app/static \
  phantom-mock
```

### 方式五：本地开发

```bash
# 克隆仓库
git clone https://github.com/Xbodwf/phantom-mock.git
cd phantom-mock

# 安装依赖
pnpm install

# 创建必要的目录
mkdir -p data static/models

# 开发模式运行（前后端同时运行）
pnpm dev:all

# 或者分别运行
pnpm dev          # 后端开发模式
pnpm dev:frontend # 前端开发模式

# 生产构建
pnpm build

# 启动生产服务
pnpm start
```

#### 本地开发使用 MongoDB

设置环境变量连接 MongoDB：

```bash
# Linux/macOS
export MONGODB_URI=mongodb://localhost:27017/phantom-mock
pnpm dev

# Windows PowerShell
$env:MONGODB_URI="mongodb://localhost:27017/phantom-mock"
pnpm dev

# 或者创建 .env 文件
echo "MONGODB_URI=mongodb://localhost:27017/phantom-mock" > .env
pnpm dev
```

## 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| PORT | 7143 | 服务端口 |
| NODE_ENV | production | 运行环境 |
| MONGODB_URI | - | MongoDB 连接字符串（可选，不设置则使用 JSON 文件存储） |

### 数据持久化

Docker 部署时建议挂载以下目录：

| 容器路径 | 说明 |
|----------|------|
| `/app/data` | 数据存储目录（JSON 模式或配置文件） |
| `/app/static` | 静态资源目录（模型图标等） |

```yaml
# docker-compose.yml
volumes:
  - ./data:/app/data
  - ./static:/app/static
```

## API 端点

### 认证方式

- **none**: 无需认证
- **api-key**: 需要 API Key（`Authorization: Bearer sk-xxx` 或 `x-api-key` 或 `x-goog-api-key`）
- **jwt**: 需要 JWT Token（登录后获取）
- **admin**: 需要管理员权限的 JWT Token

### OpenAI 兼容 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| POST | `/v1/chat/completions` | api-key | 聊天补全（支持流式） |
| POST | `/v1/completions` | api-key | 文本补全（已废弃） |
| GET | `/v1/models` | api-key | 获取模型列表 |
| GET | `/v1/models/:id` | api-key | 获取单个模型信息 |
| POST | `/v1/embeddings` | api-key | 向量嵌入 |
| POST | `/v1/moderations` | api-key | 内容审核 |
| POST | `/v1/images/generations` | api-key | 图像生成 |
| POST | `/v1/images/edits` | api-key | 图像编辑 |
| POST | `/v1/videos/generations` | api-key | 视频生成 |
| POST | `/v1/responses` | api-key | Responses API |
| POST | `/v1/rerank` | api-key | 文档重排序 |

### Anthropic 兼容 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| POST | `/v1/messages` | api-key | Anthropic Messages API |

### Google Gemini 兼容 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| POST | `/v1beta/models/:model:generateContent` | api-key | Gemini 生成内容 |
| POST | `/v1beta/models/:model:streamGenerateContent` | api-key | Gemini 流式生成 |
| POST | `/v1beta/models/:model:embedContent` | api-key | Gemini 向量嵌入 |
| GET | `/v1beta/models` | api-key | Gemini 模型列表 |
| GET | `/v1beta/models/:modelId` | api-key | Gemini 单个模型信息 |

### Actions API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/v1/actions/models` | api-key | 获取可访问的 Actions |
| POST | `/v1/actions/completions` | api-key | 调用 Action |

### 认证 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| POST | `/api/auth/send-verification-code` | none | 发送邮箱验证码 |
| POST | `/api/auth/register` | none | 用户注册 |
| POST | `/api/auth/login` | none | 用户登录 |
| POST | `/api/auth/refresh` | none | 刷新 Token |
| GET | `/api/auth/me` | jwt | 获取当前用户 |
| POST | `/api/auth/logout` | jwt | 用户登出 |

### 用户 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/user/profile` | jwt | 获取用户资料 |
| PUT | `/api/user/profile` | jwt | 更新用户资料 |
| PUT | `/api/user/password` | jwt | 修改密码 |
| GET | `/api/user/api-keys` | jwt | 获取用户 API Keys |
| GET | `/api/user/api-keys/:id/reveal` | jwt | 查看完整 API Key |
| POST | `/api/user/api-keys` | jwt | 创建 API Key |
| PUT | `/api/user/api-keys/:id` | jwt | 更新 API Key |
| DELETE | `/api/user/api-keys/:id` | jwt | 删除 API Key |
| GET | `/api/user/usage` | jwt | 获取使用统计 |
| GET | `/api/user/billing` | jwt | 获取账单信息 |
| GET | `/api/user/usage/records` | jwt | 获取使用记录 |
| GET | `/api/user/invitation` | jwt | 获取邀请信息 |
| POST | `/api/user/invitation/purchase` | jwt | 购买邀请额度 |
| GET | `/api/user/notifications` | jwt | 获取用户通知 |
| GET | `/api/user/uid` | jwt | 获取用户 UID |
| PUT | `/api/user/uid` | jwt | 设置用户 UID |
| POST | `/api/user/uid/check` | none | 检查 UID 是否可用 |

### 用户 Actions 管理

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/actions` | jwt | 获取用户的 Actions |
| GET | `/api/actions/:id` | jwt | 获取单个 Action |
| POST | `/api/actions` | jwt | 创建 Action |
| PUT | `/api/actions/:id` | jwt | 更新 Action |
| DELETE | `/api/actions/:id` | jwt | 删除 Action |
| GET | `/api/actions/docs/sandbox` | jwt | 获取沙箱接口文档 |
| POST | `/api/actions/validate` | jwt | 验证 Action 代码 |
| POST | `/api/actions/:id/publish` | jwt | 发布 Action 到广场 |
| POST | `/api/actions/:id/unpublish` | jwt | 取消发布 Action |

### Workflows API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/workflows` | jwt | 获取工作流列表 |
| GET | `/api/workflows/:id` | jwt | 获取单个工作流 |
| POST | `/api/workflows` | jwt | 创建工作流 |
| PUT | `/api/workflows/:id` | jwt | 更新工作流 |
| DELETE | `/api/workflows/:id` | jwt | 删除工作流 |
| POST | `/api/workflows/:id/run` | jwt | 运行工作流 |
| GET | `/api/workflow-runs` | jwt | 获取工作流运行记录 |
| GET | `/api/workflow-runs/:id` | jwt | 获取工作流运行详情 |
| POST | `/api/workflow-runs/:id/cancel` | jwt | 取消工作流运行 |

### 管理员 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/admin/users` | admin | 获取用户列表 |
| GET | `/api/admin/users/:id` | admin | 获取单个用户 |
| PUT | `/api/admin/users/:id` | admin | 更新用户 |
| DELETE | `/api/admin/users/:id` | admin | 删除用户 |
| GET | `/api/admin/users/:id/api-keys` | admin | 获取用户 API Keys |
| GET | `/api/admin/users/:id/usage` | admin | 获取用户使用记录 |
| GET | `/api/admin/analytics/usage` | admin | 获取使用分析 |
| GET | `/api/admin/analytics/system` | admin | 获取系统分析 |
| GET | `/api/admin/notifications` | admin | 获取通知列表 |
| POST | `/api/admin/notifications` | admin | 创建通知 |
| PUT | `/api/admin/notifications/:id` | admin | 更新通知 |
| DELETE | `/api/admin/notifications/:id` | admin | 删除通知 |
| GET | `/api/admin/models` | admin | 获取模型列表 |
| GET | `/api/admin/models/:id` | admin | 获取单个模型 |
| POST | `/api/admin/models` | admin | 创建模型 |
| PUT | `/api/admin/models/:id` | admin | 更新模型 |
| DELETE | `/api/admin/models/:id` | admin | 删除模型 |

### 管理端 API（兼容路由）

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/models` | admin | 获取模型列表 |
| POST | `/api/models` | admin | 创建模型 |
| PUT | `/api/models/:id` | admin | 更新模型 |
| DELETE | `/api/models/:id` | admin | 删除模型 |
| GET | `/api/model-icons` | admin | 获取模型图标列表 |
| POST | `/api/model-icons/upload` | admin | 上传模型图标 |
| DELETE | `/api/model-icons/:filename` | admin | 删除模型图标 |
| GET | `/api/stats` | admin | 获取系统统计 |
| GET | `/api/settings` | admin | 获取系统设置 |
| PUT | `/api/settings` | admin | 更新系统设置 |
| GET | `/api/keys` | admin | 获取所有 API Keys |
| GET | `/api/keys/:id/reveal` | admin | 查看完整 API Key |
| POST | `/api/keys` | admin | 创建 API Key |
| PUT | `/api/keys/:id` | admin | 更新 API Key |
| DELETE | `/api/keys/:id` | admin | 删除 API Key |

### 公开 API

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/api/server-config` | none | 获取服务器配置 |

### WebSocket

| 方法 | 路径 | 认证 | 描述 |
|------|------|------|------|
| GET | `/ws` | none | WebSocket 连接（用于实时请求推送） |

## 使用方法

1. 访问前端界面：`http://localhost:7143`
2. 在界面中添加模型配置
3. 为模型上传或选择图标（可选）
4. 当有请求到达时，在前端输入响应内容
5. 服务器会将输入的内容作为 AI 响应返回

## 技术栈

- 后端：Node.js + Express + TypeScript
- 前端：React + Vite + MUI
- 数据库：MongoDB（可选）或 JSON 文件
- 通信：WebSocket

## License

ISC