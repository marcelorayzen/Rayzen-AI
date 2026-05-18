#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f ".env.agent.server" ]]; then
  echo "ERRO: .env.agent.server nao encontrado."
  echo "Copie .env.agent.server.example para .env.agent.server e preencha AGENT_TOKEN."
  exit 1
fi

set -a
source .env.agent.server
set +a

if [[ "${AGENT_ROLE:-}" != "server" ]]; then
  echo "ERRO: agent-server-start.sh exige AGENT_ROLE=server."
  exit 1
fi

if [[ -z "${AGENT_API_URL:-}" || -z "${AGENT_TOKEN:-}" ]]; then
  echo "ERRO: AGENT_API_URL e AGENT_TOKEN sao obrigatorios."
  exit 1
fi

echo "Validando acesso ao servidor Rayzen..."
curl -fsS -H "Authorization: Bearer ${AGENT_TOKEN}" "${AGENT_API_URL}/tasks/pending?role=server" >/dev/null

echo "Compilando Agent..."
pnpm --filter agent build

echo "Iniciando Agent server..."
exec env $(grep -v '^#' .env.agent.server | xargs) pnpm --filter agent start
