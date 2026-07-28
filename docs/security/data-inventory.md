# Inventário de Dados Sensíveis

> 🤖 **GERADO** por `scripts/scan-secrets.mjs` (`pnpm scan:secrets`) — não edite à mão.
> Gerado em: 2026-07-28T02:34:16.595Z · Escopo: arquivos versionados (git ls-files)

## 1. Segredos detectados em arquivos versionados

✅ Nenhum segredo detectado em arquivos versionados.

## 2. Arquivos que contêm segredos (devem estar gitignored)

| Arquivo | Existe | Gitignored | Versionado |
|---|---|---|---|
| `.env` | sim | sim | não ✅ |
| `apps/agent/src/hooks/hook.config.mjs` | sim | sim | não ✅ |
| `vault/*.enc`, `.env.*` | — | esperado | não |

## 3. Categorias de dados sensíveis e onde vivem

| Categoria | Onde | Proteção |
|---|---|---|
| Chaves de API (OpenAI, Groq, Anthropic, Jina) | `.env` (gitignored) | env var, nunca em contexto LLM |
| Senha admin / JWT secret | `.env` | env var |
| Token JWT do agente/hook | `hook.config.mjs` (gitignored) | arquivo local, expira 30d |
| Segredos de projeto (supabase, vercel, etc.) | `vault/*.enc` | AES-256-GCM, ref `vault://` |
| Chave SSH da VPS | `~/.ssh/*.pem` (fora do repo) | filesystem local |
| Conteúdo de conversas / prompts | Postgres `conversation_messages` | acesso via JWT |
| Embeddings de documentos | Postgres `documents` (pgvector) | acesso via JWT |
| IP / infra da VPS | docs operacionais | usar placeholder `<VPS_IP>` em docs versionadas |
