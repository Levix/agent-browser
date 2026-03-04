#!/bin/bash
set -e

# Quick local development setup script
# Usage: ./scripts/dev-link.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Agent Browser - 本地调试快速构建${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Build TypeScript
echo -e "${YELLOW}[1/4] 构建 TypeScript...${NC}"
cd "$PROJECT_ROOT"
pnpm build
echo -e "${GREEN}✓ TypeScript 构建完成${NC}"
echo ""

# Step 2: Build native binary
echo -e "${YELLOW}[2/4] 构建 Native 二进制文件...${NC}"
pnpm build:native
echo -e "${GREEN}✓ Native 二进制文件构建完成${NC}"
echo ""

# Step 3: Check and remove existing link
echo -e "${YELLOW}[3/4] 检查并移除已有的全局 link...${NC}"
if pnpm list -g | grep -q "agent-browser"; then
    echo -e "${BLUE}检测到已存在的全局 link，正在移除...${NC}"
    pnpm unlink -g agent-browser 2>/dev/null || true
    echo -e "${GREEN}✓ 已移除旧的 link${NC}"
else
    echo -e "${BLUE}未检测到已有的 link${NC}"
fi
echo ""

# Step 4: Create new global link
echo -e "${YELLOW}[4/4] 创建新的全局 link...${NC}"
pnpm link --global
echo -e "${GREEN}✓ 全局 link 创建完成${NC}"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✓ 本地调试环境设置完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}现在你可以在其他项目中使用:${NC}"
echo -e "${YELLOW}  pnpm link --global agent-browser${NC}"
echo ""
echo -e "${BLUE}或者直接运行:${NC}"
echo -e "${YELLOW}  agent-browser${NC}"
echo ""
