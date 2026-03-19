# Phantom Mock

一个AI接口服务器。
支持OpenAI/Gemini/Anthropic等主流接口

## 功能特性

- 轻量
- 即开即用

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

### MongoDB 端口访问

当使用 MongoDB 部署时，默认会开放 MongoDB 端口（27017），可用于：
- 数据备份和恢复
- 数据迁移
- 数据库管理工具连接

**安全建议**：生产环境建议移除 MongoDB 端口映射，或通过防火墙限制访问。

## 使用方法

1. 访问前端界面：`http://localhost:7143`
2. 在界面中添加模型配置
3. 为模型上传或选择图标（可选）
4. 当有请求到达时，在前端输入响应内容
5. 服务器会将输入的内容作为 AI 响应返回

## API 端点

- `GET /` - 前端界面
- `POST /v1/chat/completions` - OpenAI 兼容的聊天接口
- `GET /v1/models` - 获取模型列表
- `GET /v1/models/:id` - 获取单个模型信息
- `GET /api/models` - 获取模型列表（管理接口）
- `POST /api/models` - 添加模型（管理员）
- `PUT /api/models/:id` - 更新模型（管理员）
- `DELETE /api/models/:id` - 删除模型（管理员）
- `GET /api/model-icons` - 获取模型图标列表（管理员）
- `POST /api/model-icons/upload` - 上传模型图标（管理员）
- `DELETE /api/model-icons/:filename` - 删除模型图标（管理员）
- `WS /ws` - WebSocket 连接

## 技术栈

- 后端：Node.js + Express + TypeScript
- 前端：React + Vite + MUI
- 数据库：MongoDB（可选）或 JSON 文件
- 通信：WebSocket

## License

ISC
