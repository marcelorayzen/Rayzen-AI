# Rayzen AI — Guia de Início Rápido

Para novos usuários que querem colocar o Rayzen funcionando do zero.

> Estado atual do projeto: stack central em VPS + Agent desktop no PC de trabalho.

---

## O que é o Rayzen AI

Plataforma pessoal de IA com:
- **Chat** com streaming e memória semântica
- **Jarvis** — executa tarefas no seu PC (abrir apps, Git, Docker, emails, etc.)
- **Brain** — base de conhecimento pessoal com busca semântica
- **Doc Engine** — gera PDFs e DOCX
- **Content Studio** — cria posts, threads, artigos
- **TTS/STT** — fala e ouça respostas

Tudo configurável via painel visual ou arquivo `rayzen.config.json`.

---

## Pré-requisitos

- Node.js 20 LTS
- pnpm (`npm install -g pnpm`)
- Docker Desktop
- Git

---

## Instalação

```bash
git clone https://github.com/marcelorayzen/rayzen-ai.git
cd rayzen-ai
pnpm install
cp .env.example .env
```

---

## Configurar variáveis de ambiente

Edite o arquivo `.env` na raiz e em `apps/api/.env`:

```bash
# LLM
ANTHROPIC_API_KEY=sk-ant-...  # Claude - recomendado para chat principal
GROQ_API_KEY=gsk_...          # Groq - voz/STT/TTS
OPENAI_API_KEY=sk-...         # OpenAI - embeddings/fallback

# Embeddings
JINA_API_KEY=jina_...         # Jina AI — gratuito em jina.ai

# Sistema
LITELLM_MASTER_KEY=sk-rayzen-qualquercoisa
LITELLM_BASE_URL=http://localhost:4100/v1
DATABASE_URL=postgresql://rayzen:senha@localhost:55432/rayzen_app
REDIS_URL=redis://localhost:56379
JWT_SECRET=<rode: openssl rand -hex 32>

# Senha de acesso ao painel
ADMIN_PASSWORD=suasenha
```

### Como obter as chaves

| Chave | Onde obter | Custo |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com -> API Keys | Pago por uso |
| `GROQ_API_KEY` | console.groq.com → API Keys | Gratuito |
| `JINA_API_KEY` | jina.ai → API | Gratuito (1M tokens/mês) |
| `LITELLM_MASTER_KEY` | Você mesmo define — qualquer string | — |
| `ADMIN_PASSWORD` | Você mesmo define | — |

---

## Subir a infraestrutura local (desenvolvimento)

```bash
# Inicia PostgreSQL, Redis e LiteLLM proxy
docker compose up -d

# Verifica se subiu
docker compose ps
```

## Criar o banco de dados

```bash
pnpm db:migrate
```

---

## Iniciar o projeto

Abra **3 terminais**:

```bash
# Terminal 1 — API
pnpm dev:api

# Terminal 2 — Web
pnpm dev:web

# Terminal 3 — Agent (só se quiser usar Jarvis)
pnpm dev:agent
```

Acesse **http://localhost:3100** e faça login com sua `ADMIN_PASSWORD`.

## Operação atual em produção

Na instalação atual:

- Web: `http://<VPS_IP>:3100`
- API: `http://<VPS_IP>:3101`
- Banco oficial: VPS
- Agent desktop: PC de trabalho via `agent-start.bat`
- Agent server: VPS via `docker compose up -d agent-server`

Para o fluxo detalhado, consulte `docs/remote-agent-setup.md`.

---

## Primeira configuração

Clique no ícone ⚙ no header para abrir as **Configurações**:

1. **Identidade** — mude o nome do assistente e personalidade
2. **Módulos** — ative só o que você vai usar
3. **LLM** — ajuste modelos se necessário
4. **Agent** — ative/desative ações individuais
5. **Segurança** — configure o que executa com dryRun
6. **Voz** — escolha o provider e voz do TTS

Clique em **Salvar** — as mudanças são aplicadas imediatamente.

---

## Alimentar o Brain (memória)

Clique no ícone ↑ no header:

- **GitHub** — indexa todos os seus repositórios
- **Arquivo** — sobe PDF ou TXT (currículo, projetos)
- **URL** — indexa qualquer página pública

Durante conversas, o Rayzen aprende automaticamente informações pessoais que você menciona.

---

## Comandos úteis

```bash
pnpm db:studio          # Visualizar banco de dados
pnpm typecheck          # Verificar TypeScript
pnpm lint               # Verificar ESLint
docker compose logs -f  # Logs da infra
```

---

## Problemas comuns

| Erro | Solução |
|---|---|
| `EADDRINUSE 3001` | `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess -Force` |
| Prisma migration interativa | Rode `pnpm db:migrate` no PowerShell diretamente |
| Agent não executa tarefas | Verifique se `pnpm dev:agent` está rodando |
| Brain não encontra documentos | Verifique `JINA_API_KEY` no `.env` |

---

## Estrutura de arquivos importantes

```
rayzen.config.json          ← configuração central de tudo
.env / apps/api/.env        ← chaves e variáveis de ambiente
docs/
  getting-started.md        ← este arquivo
  personalization.md        ← guia completo de personalização
  agent.md                  ← documentação do PC Agent
  diary.md                  ← histórico de decisões e problemas
```
