# Fake AI Server

一个模拟 OpenAI API 的服务器，带有前端界面用于输入响应内容。

## 功能特性

- 模拟 OpenAI API 接口（/v1/chat/completions）
- 支持 WebSocket 实时通信
- 前端界面管理和输入响应内容
- 支持多模型配置
- 请求历史记录

## 快速部署

### 方式一：Docker Compose（推荐）

```bash
# 克隆仓库
git clone https://github.com/Xbodwf/fake-ai-server.git
cd fake-ai-server

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

服务将在 `http://localhost:7143` 启动。

### 方式二：通过镜像拉取
```bash
# 运行容器
docker run -d \
  --name fake-ai-server \
  -p 7143:7143 \
  -v $(pwd)/data:/app/data \
  xbodwf/fake-ai-server:v1.1
```

### 方式三：Docker 手动构建

```bash
# 构建镜像
docker build --no-cache -t fake-ai-server .

# 运行容器
docker run -d \
  --name fake-ai-server \
  -p 7143:7143 \
  -v $(pwd)/data:/app/data \
  fake-ai-server
```

### 方式四：本地开发

```bash
# 安装依赖
npm install
cd frontend && npm install && cd ..

# 开发模式运行
npm run dev

# 或者构建后运行
npm run build
npm start
```

## 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| PORT | 7143 | 服务端口 |
| NODE_ENV | production | 运行环境 |

### 数据持久化

数据默认存储在 `/app/data` 目录，建议挂载到宿主机：

```yaml
# docker-compose.yml
volumes:
  - ./data:/app/data
```

## 使用方法

1. 访问前端界面：`http://localhost:7143`
2. 在界面中添加模型配置
3. 当有请求到达时，在前端输入响应内容
4. 服务器会将输入的内容作为 AI 响应返回

## 国内镜像加速

Dockerfile 已配置使用淘宝镜像源（npmmirror），无需额外配置。

如需修改镜像源，可在 Dockerfile 中更改：

```dockerfile
RUN yarn config set registry https://registry.npmmirror.com
```

## API 端点

- `GET /` - 前端界面
- `POST /v1/chat/completions` - OpenAI 兼容的聊天接口
- `GET /v1/models` - 获取模型列表
- `WS /ws` - WebSocket 连接

## 技术栈

- 后端：Node.js + Express + TypeScript
- 前端：React + Vite + MUI
- 通信：WebSocket

## License

ISC
