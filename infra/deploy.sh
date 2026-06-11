#!/usr/bin/env bash
# Deploy Rayzen AI no notebook local (192.168.0.175)
# Uso: ./infra/deploy.sh [serviço...]
#   Sem argumento: builda api + mcp-http (os dois que mudam com código TypeScript)
#   Com argumento:  docker compose up -d --build <serviços>
#
# Pré-requisito: usuário rayzen no grupo docker (sem sudo)
# Executar na raiz do projeto no notebook: ~/projects/rayzen-ai

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

SERVICES="${*:-api mcp-http}"

echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S') — serviços: $SERVICES"
echo "[deploy] dir: $PROJECT_DIR"

docker compose up -d --build $SERVICES

echo "[deploy] aguardando health checks..."
sleep 5

docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -E "api|mcp"

echo "[deploy] concluído."
