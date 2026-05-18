# Rayzen AI — Diário de Projeto

Registro cronológico de decisões técnicas, problemas enfrentados, melhorias implementadas e aprendizados do projeto.
O objetivo é que qualquer pessoa (ou eu mesmo no futuro) consiga entender o caminho percorrido e o raciocínio por trás de cada escolha.

---

## Como usar este diário

- **Novo problema resolvido?** → adicione uma entrada em `## Problemas`
- **Decisão importante tomada?** → adicione em `## Decisões`
- **Feature entregue?** → adicione em `## Histórico de versões`
- **Aprendizado útil?** → adicione em `## Aprendizados`
- Use datas no formato `YYYY-MM-DD`
- Seja direto — o contexto importa mais do que a forma

---

## Governança e regras do projeto

### Regras inegociáveis
- Nenhuma ação do PC Agent é executada fora da `whitelist.ts`
- Path traversal (`../`) sempre bloqueado em ações de arquivo
- `dryRun: true` obrigatório antes de qualquer ação destrutiva
- Sem `exec()` ou `spawn()` livre — apenas ações tipadas
- TypeScript 100% — sem `any` explícito

### Regras de qualidade
- Coverage mínimo: branches 70%, functions 80%, lines 80%
- Todo módulo NestJS tem seu próprio system prompt
- `tokens_used` e `duration_ms` logados em toda chamada ao LLM
- LLM sempre via LiteLLM proxy — nunca direto para OpenAI/Groq

### Padrão de decisão (ADR)
Antes de mudar uma decisão arquitetural, registrar aqui:
- O que mudou
- Por que mudou
- Qual era a alternativa descartada

---

## Decisões técnicas

### 2026-04-01 — LLM: OpenAI → Groq
**Contexto:** Quota da OpenAI esgotada durante o desenvolvimento inicial.
**Decisão:** Migrar para Groq (gratuito) usando LiteLLM como proxy. Todos os modelos no código (`gpt-4o`, `gpt-4o-mini`) continuam iguais — só o `config.yaml` do LiteLLM aponta para os modelos Groq.
**Modelo mapeado:** `meta-llama/llama-4-scout-17b-16e-instruct`
**Impacto:** Zero — nenhuma linha de código da API precisou mudar.

### 2026-04-01 — Embeddings: OpenAI → Jina AI
**Contexto:** Embeddings OpenAI requerem quota paga.
**Decisão:** Usar Jina AI (`jina-embeddings-v3`) com tier gratuito.
**Dimensão:** 1024 (vs 1536 do OpenAI `text-embedding-3-small`).
**Impacto:** Schema do banco alterado — `vector(1024)`. Quem quiser voltar para OpenAI precisa rodar migration + `ALTER TABLE`.

### 2026-04-01 — TTS: LiteLLM proxy → Groq direto
**Contexto:** LiteLLM não suportava corretamente o endpoint de TTS do Groq (áudio binário).
**Decisão:** `tts.service.ts` chama o Groq diretamente usando `GROQ_API_KEY`, bypass do LiteLLM apenas para TTS.
**Exceção documentada:** É a única chamada que não passa pelo proxy.

### 2026-04-01 — Auth: JWT custom com senha única
**Contexto:** ADR-007 em aberto (Auth.js vs Clerk vs JWT custom). Como é ferramenta pessoal, OAuth seria over-engineering.
**Decisão:** Senha única em `ADMIN_PASSWORD` no `.env`, JWT com 30 dias de expiração.
**Revisão futura:** Se o projeto for multi-usuário, migrar para Auth.js com Google OAuth.

---

### 2026-04-02 — Sistema de configuração central
**Contexto:** Projeto cresceu com muitas personalizações espalhadas em código. Para tornar reutilizável por outros usuários, precisava de uma forma de configurar tudo sem tocar no código.
**Decisão:** Arquivo `rayzen.config.json` na raiz + `ConfigPanelModule` na API + página `/settings` no painel. O config cobre: identidade, módulos, LLM por módulo, ações do agent, sandbox, segurança e TTS.
**Impacto:** Zero no funcionamento atual — é additive. Novos usuários podem clonar e configurar tudo pelo painel sem tocar em nenhum arquivo TypeScript.

---


### 2026-05-18 — Consolidação VPS, Agents por papel e evidências de QA
**Contexto:** O Rayzen deixou de operar com API/banco no notebook e passou a usar uma VPS central, mantendo ações locais no PC de trabalho.
**Decisão:** Consolidar `main` como branch principal, separar Agents por papel (`desktop` e `server`) e usar `repoSlug` como identidade técnica por projeto.
**Impacto:** API, Web, Postgres, Redis, LiteLLM e Agent server rodam na VPS; o Agent desktop executa ações locais e preserva a separação entre projetos.

### 2026-05-18 — Evidências visuais viraram artefato de QA
**Contexto:** Screenshots eram úteis como prova, mas ficavam soltos e sem vínculo claro com projeto/documentação.
**Decisão:** Capturas com projeto ativo agora salvam em `Pictures\Rayzen\<repoSlug>`, fazem upload para a API, aparecem na aba **Evidências** e alimentam o documento **Evidências de teste**.
**Impacto:** O texto após `:` no comando vira descrição, base do nome do arquivo e categoria automática (`api_test`, `manual_test`, `bug`, `fix`, `general`).
**Próxima evolução planejada:** primeiro vincular evidências a `TestRun`; depois vincular a uma falha/caso específico do run.

## Problemas enfrentados

### 2026-04-01 — Navegador abrindo em loop infinito
**Sintoma:** Dezenas de janelas do Chrome abrindo automaticamente ao rodar `pnpm dev:agent`.
**Causa raiz:** Bug no `AgentBridgeService` — `getPending()` retornava jobs BullMQ em estado `waiting` sem filtrar pelo `data.status`. O job de `open_app` ficava preso como `waiting` no BullMQ mesmo após ser marcado como `processing`/`done` no `job.data`. A cada poll de 3 segundos, o agent reexecutava o mesmo job.
**Solução:** Filtro `status === 'pending'` no `getPending()`. O `updateStatus` apenas atualiza o `job.data` sem remover — o `waitForResult` do Jarvis precisa encontrar o job para ler o resultado.
**Lição:** Em BullMQ, `job.update()` não muda o estado interno da fila — só os dados. O estado BullMQ (`waiting`, `active`, `completed`) é separado do `data.status` que controlamos.

### 2026-04-01 — Memória automática não indexando
**Sintoma:** Usuário dizia "meu nome é X" mas `/brain/documents` retornava vazio.
**Causa raiz 1:** Mensagens como "meu nome é Marcelo" eram classificadas pelo LLM como módulo `brain` (busca) em vez de `system` (afirmação). O módulo `brain` tem early return sem chamar `extractAndIndex()`.
**Causa raiz 2:** `extractAndIndex()` tinha `catch {}` silencioso — erros não apareciam nos logs.
**Solução:** Exemplos adicionados ao classifier distinguindo afirmações pessoais (`system`) de perguntas sobre memória (`brain`). Log de erro adicionado ao catch. `extractAndIndex` chamado também no branch do módulo `brain`.

### 2026-04-01 — Dimensão do pgvector incompatível
**Sintoma:** Erro ao indexar documentos no Brain.
**Causa:** Schema criado com `vector(1536)` (OpenAI) mas Jina retorna `vector(1024)`.
**Solução:** `ALTER TABLE documents ALTER COLUMN embedding TYPE vector(1024)` + migration atualizada.

### 2026-04-01 — `@fastify/multipart` incompatível
**Sintoma:** Erro ao fazer upload de áudio para STT.
**Causa:** Versão 9 do `@fastify/multipart` incompatível com Fastify 4.
**Solução:** Downgrade para versão 8 (`pnpm add @fastify/multipart@^8`).

### 2026-04-01 — Porta 3001 ocupada (EADDRINUSE)
**Sintoma:** API não sobe, erro `listen EADDRINUSE 0.0.0.0:3001`.
**Causa:** Processo anterior da API ainda em memória.
**Solução:** `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess -Force`

### 2026-04-01 — Streaming exibindo tudo de uma vez
**Sintoma:** Resposta aparecia inteira de uma vez, sem efeito typewriter.
**Causa:** `setMessages` era chamado diretamente a cada token, mas React batcha as atualizações de estado — todos os tokens chegavam antes do render.
**Solução:** Fila de tokens (`tokenQueueRef`) + `setTimeout` de 18ms entre cada token para forçar renders individuais.

### 2026-04-01 — Middleware Next.js causando erro no browser
**Sintoma:** `[Error: The Middleware file "/middleware" must export a function named middleware or a default function]`
**Causa:** Next.js 16 exige que `middleware.ts` exporte uma função mesmo que vazia.
**Solução:** Autenticação movida para client-side via `useEffect` + `localStorage`. Middleware exporta `NextResponse.next()` passando tudo.

---

## Histórico de versões

### v0.1.0 — 2026-04-01 — MVP funcional
**Features entregues:**
- Chat com streaming SSE (typewriter effect)
- Classificador de intent com 5 módulos (jarvis, brain, doc, content, system)
- Brain — memória semântica com pgvector + Jina embeddings
- Brain — indexação automática de informações pessoais durante conversa
- Brain — importação via GitHub (repos + READMEs), arquivo PDF/TXT, URL
- Jarvis — execução de tarefas locais (abrir app, listar dir, info do sistema)
- Doc Engine — geração de PDF com Puppeteer
- Content Studio — posts, threads, artigos, calendário editorial
- TTS — síntese de voz via Groq Orpheus
- STT — transcrição de áudio via Groq Whisper + auto-send
- Stats — contador de tokens por sessão e diário
- Histórico de conversas com sidebar + delete de sessões
- Login por senha com JWT 30 dias
- Rate limiting 120 req/min

**Stack definida:**
- Backend: NestJS 10 + Fastify
- Frontend: Next.js 16 App Router
- LLM: Groq via LiteLLM proxy
- DB: PostgreSQL + pgvector
- Queue: Redis + BullMQ

---

## Aprendizados

- **BullMQ:** `job.update()` ≠ mudança de estado da fila. Estado BullMQ e dados do job são independentes.
- **LiteLLM:** Excelente para abstrair providers de LLM. Trocar de OpenAI para Groq foi zero impacto no código.
- **pgvector:** Alterar dimensão do vetor depois de criar a tabela requer `ALTER TABLE` manual — migrations do Prisma não conseguem fazer isso automaticamente.
- **Next.js 16:** Auto-abre o browser no dev por padrão. Usar `--no-open` (se disponível na versão) ou desabilitar via `devIndicators: false` no config.
- **Groq:** Tier gratuito generoso para desenvolvimento. Modelos Llama 4 funcionam bem para classificação e chat.
- **OneDrive + Next.js:** Lentidão significativa no hot reload. Para desenvolvimento intenso, mover o projeto para fora do OneDrive.

---

## Backlog técnico

- [ ] Deploy VPS Ubuntu/Azure (concluido; revisar dominio/HTTPS)
- [ ] Autenticação multi-usuário com Google OAuth (ADR-007 — se necessário)
- [ ] Bull Board para monitorar filas (compatível com Fastify 5)
- [ ] ElevenLabs TTS para voz PT-BR nativa
- [ ] Scheduler (BullMQ repeat ou node-cron) — Fase 6
- [ ] Atualizar Puppeteer para versão >= 24.15.0 (deprecation warning)
- [ ] Sidebar com busca no histórico de conversas
- [ ] Exportar conversa como PDF/TXT
- [ ] **Migrar Outlook para Microsoft Graph API** — A automação COM (`New-Object -ComObject Outlook.Application`) só funciona com o Outlook clássico. O novo Outlook (versão web/wrapper) não expõe o objeto COM. Migrar para a [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/api/user-list-messages) requer registrar um app no Azure AD com permissões `Mail.Read` e `Mail.Send`. Funciona com qualquer versão do Outlook e também com outros provedores Microsoft 365.
