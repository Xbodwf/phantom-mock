# 基础镜像层 - 共享 pnpm 配置
FROM node:24-alpine AS base
RUN corepack enable && pnpm config set registry https://registry.npmmirror.com

# 依赖安装阶段
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# 构建阶段
FROM deps AS builder
COPY tsconfig.json tsconfig.backend.json tsconfig.frontend.json vite.config.ts index.html ./
COPY public/ ./public/
COPY src/ ./src/
RUN pnpm build:all

# 生产阶段
FROM base AS production
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune && rm -rf /tmp/*
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data /app/static/models
EXPOSE 7143
ENV NODE_ENV=production
ENV PORT=7143
CMD ["node", "dist/index.js"]
