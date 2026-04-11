#!/bin/bash

# Fake OpenAI Server 启动脚本
# 先构建前端，再启动后端服务

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "Fake OpenAI Server 启动脚本"
echo "========================================"

# 设置生产环境变量
export NODE_ENV=production

# 检查 node 是否存在
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 node，请先安装 Node.js"
    exit 1
fi

# 步骤 1: 检查依赖
echo ""
echo "[1/3] 检查依赖..."
if [ ! -d "node_modules" ]; then
    echo "安装依赖..."
    pnpm install || npm install || yarn install
fi

# 步骤 2: 构建项目（SSR模式）
echo ""
echo "[2/3] 构建项目 (SSR模式)..."
pnpm build:ssr || npm run build:ssr || yarn build:ssr

# 步骤 3: 启动服务器
echo ""
echo "[3/3] 启动服务器..."
echo "========================================"
echo "NODE_ENV: $NODE_ENV"
echo "========================================"
pnpm start || npm start || yarn start
