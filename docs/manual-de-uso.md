# Rayzen AI — Manual de Uso

> Manual operacional + arquitetura. Como o Rayzen funciona hoje e como usá-lo no dia a dia.
> Última revisão: 2026-06-24 (Fases 1–5 concluídas; fixes specialist loop + QA Scientist + Goal Graph).

---

## 1. O que é o Rayzen (em uma frase)

Uma plataforma pessoal de IA que **preserva contexto** (memória semântica, decisões, runbooks), **observa seu trabalho** (hook do Claude Code) e **alimenta o Claude Code** com contexto cirúrgico e relevante — para que problemas resolvidos uma vez não precisem ser resolvidos de novo.

**Papéis claros:**

| Quem | Papel |
|---|---|
| **Rayzen** | Cérebro persistente: memória semântica · contexto · governança QA · write-back de aprendizados |
| **Claude Code** | Executor: código, deploy, testes, análise |
| **Agent desktop** | Executor local: browser, terminal, screenshots, git |

**Rayzen não executa código diretamente.** A função principal é ser um context broker: entregar contexto comprimido e relevante ao Claude Code, registrar decisões e armazenar artefatos QA. O motor de missões V2 existe e está funcional para missões estruturadas (ver Seção 6).

---

## 2. Arquitetura

### 2.1 Os três lugares onde o Rayzen vive

```
┌─ Sua máquina (Windows) ──────────────┐     ┌─ Servidor local (Ubuntu · Docker) ────────┐
│ • VS Code + Claude Code               │     │ • PostgreSQL 16 + pgvector                 │
│ • Hook (rayzen-hook.mjs)  ───eventos──┼────▶│   schemas: public (V1) · v2 (V2) · langfuse│
│ • Agent desktop (rayzen-start.bat)    │◀────┼─ tarefas ─ • Redis 7 + BullMQ             │
│ • MCP stdio (.mcp.json)               │     │ • LiteLLM proxy (:4000)                    │
└───────────────────────────────────────┘     │ • API V1 (:3101) — uso diário              │
                                               │ • API V2 (:3103, prefixo /v2)              │
                                               │ • Web (:3100) · MCP HTTP (:3102)           │
                                               │ • Langfuse (:3200) — observabilidade LLM   │
                                               │ • Caddy + Cloudflare Tunnel (HTTPS)        │
                                               └───────────────────────────────────────────┘
```

- **Hook** = sensor passivo. Cada ação no Claude Code (Edit/Write/Bash) vira um evento no Rayzen.
- **Agent** = braço executor. Recebe tarefas (`jarvis:*`) e executa no SO local (whitelist obrigatória). **Requer `rayzen-start.bat` rodando** — sem ele, skills `jarvis:*` retornam 500.
- **MCP** = ponte para o Claude Code e claude.ai consultarem e gravarem no Rayzen.
- **Infra** = servidor local dedicado (`servidor-local`), Cloudflare Tunnel para
  domínio `rayzen.com.br`. Não é mais o notebook — ele foi aposentado em 2026-08-09, e o `.174`
  era a reserva DHCP dele. Ver `docs/migracao-servidor.md`.

### 2.2 Estado dos módulos V2

| Estado | Módulos |
|---|---|
| **Ativos** | `benchmark`, `evolutionary`, `agent-dialogue`, `qa-scientist`, `context-engine`, `specialist-agent`, `approval-gates`, `knowledge`, `memory`, `mission`, `router`, `step-executor`, `mission-scheduler` |
| **Dependem do agent desktop** | `jarvis:git_log`, `jarvis:file_search`, `jarvis:run_command`, `jarvis:file_write` — retornam 500 sem agent rodando; specialist aborta após **3 falhas consecutivas** (não gasta 10 iterações) |

### 2.3 LiteLLM — mapeamento de modelos

| Alias | Modelo real |
|---|---|
| `gpt-4o` | Groq llama-3.3-70b (fallback Claude Sonnet) |
| `gpt-4o-mini` | Groq llama-8b |
| `gpt-4o-premium` | Claude Sonnet direto |

> Claude não suporta `response_format: json_object` — usar extração robusta (strip code fences + regex).

---

## 3. Setup diário

1. **Servidor ligado.** A stack (Postgres, Redis, LiteLLM, APIs, Web, MCP, Langfuse, Cloudflared) sobe sozinha com `restart: unless-stopped`.
2. **Agent desktop.** Na sua máquina, rode `rayzen-start.bat` — sobe agent + widget e faz o polling de tarefas `jarvis:*`. Sem ele, steps de missões que usam skills jarvis falham.
3. **VS Code + Claude Code.** Abra a pasta do projeto. O hook detecta o projeto pelo `git remote` e começa a capturar eventos.
4. **Web.** Abra `https://rayzen.com.br` e selecione o projeto no topo. (A porta `3100` publica em `127.0.0.1` e nao responde fora do servidor.)

### Diagnóstico rápido

```bash
# Status de todos os serviços (postgres, redis, litellm, api-v2, mcp, JWT)
GET https://api.rayzen.com.br/infra/health

# Langfuse (traces LLM)
http://servidor-local:3200
```

---

## 4. Como o hook vincula seu trabalho ao projeto certo

```
Você edita um arquivo no VS Code
   → hook lê o nome do repositório (git remote get-url origin)
   → consulta GET /projects?repoSlug=<nome>
   → vincula o evento ao projeto correspondente
```

**Resolução robusta:** `rayzen-ai-private`, `Rayzen-AI`, `Rayzen_AI` todos resolvem para o mesmo projeto — o backend normaliza (minúsculas, remove sufixo `-private`, troca `_`↔`-`).

**Stale-while-error:** se a rede pisca durante um deploy, o hook reusa o cache em vez de perder o evento.

**Diagnóstico:** `GET /events/hook/health` lista todos os projetos, último evento e eventos órfãos.  
**Badge da Atividade:** 🟢 ao vivo (<10 min) · 🟡 há Xh · 🔴 parado.

---

## 5. Os painéis — o que cada um faz e QUANDO atualiza

| Painel | O que mostra | Quando atualiza | Como forçar |
|---|---|---|---|
| **Atividade** | Eventos do hook em tempo real | **Sozinho, a cada 5s** | — |
| **Goal Graph** | Meta ativa + critérios + KPIs + histórico de metas conquistadas | **Só quando você edita / ao conquistar meta** | Botão "EDITAR META" / "+ critério" |
| **Documentação viva** | 5 docs (estado, decisões, próximas ações, diário, evidências) | **No checkpoint** | Botão "Regenerar" / checkpoint |
| **Universe** | Canvas: docs, decisões e relações | **Manual** | Botão "atualizar" / "importar projeto" |
| **Brain / Memória** | Busca semântica na memória indexada | Ao indexar fontes | Painel Brain → indexar |
| **Missões** | Missões V2 ativas, steps, gates de aprovação | **Ao vivo via WebSocket** | Botão "missões" no Header |
| **Dados** (`/insights`) | Custo por módulo/modelo e o grafo de conhecimento | **A cada carga da tela** | Botão "dados" no Header / "atualizar" |

**Regra:** se um painel parece desatualizado, quase sempre é porque não atualiza sozinho — depende de checkpoint (Doc viva) ou edição manual (Goal Graph). Só a Atividade e Missões são ao vivo.

### Painel "Dados" — o que ler nele

Duas abas, com uma ressalva em cada:

- **custo** — quanto cada módulo gastou (`benchmark:geracao`, `qa-scientist:analyze`, `router:chat`…).
  Os rótulos são os mesmos do `caller` no Langfuse, então as duas visões comparam sem tradução.
  **Só há registro para chamadas feitas depois de 14/08/2026**: antes disso nada gravava custo
  (detalhes em `docs/FROZEN.md`). Um `$0` em período anterior é ausência de medição, não economia —
  a tela avisa isso explicitamente.
- **conhecimento** — 537 dos 570 nós são varredura de arquivos, a mesma informação que
  `graphify query` dá no terminal. O que existe só ali é a **camada semântica** (33 nós: módulos,
  entidades, conceitos, regras, ADRs), que a tela lista em separado. A lista "mais dependidos"
  responde o raio de impacto de mexer num arquivo.

### Limitação conhecida — ruído na Doc viva

O ProjectState e a Doc viva derivam dos eventos do hook via LLM. Sessões com muitos comandos Bash/SSH de diagnóstico poluem o sinal — "Testar API local" vira "próxima ação". O **Goal Graph é a fonte estratégica confiável**; a Doc viva é apoio, não verdade absoluta.

---

## 6. Motor de missões V2

### 6.1 Criar e executar uma missão

```bash
# 1. Criar missão via router (linguagem natural → steps gerados por LLM)
POST /v2/route
{
  "projectId": "<id>",
  "objective": "Analisar benchmark do módulo de context_synthesis"
}

# 2. Executar a missão
POST /v2/missions/:missionId/execute

# 3. Acompanhar no painel "missões" da Web
```

### 6.2 Tipos de executor por step

| Executor | Quem executa | O que significa |
|---|---|---|
| `ai` | SpecialistService (LLM loop) | Specialist roda automaticamente com skills jarvis |
| `human` | Claude Code + usuário | Step requer ação manual; missão fica em `paused` aguardando |
| `skill` | SkillEngine direto | Skill específica despachada sem loop specialist |

**Steps `executor: human`** = Claude Code ou o usuário executam manualmente, depois marcam o step como done:
```bash
PATCH /v2/missions/:missionId/steps/:stepId
{ "status": "done", "output": "descrição do que foi feito" }
```

### 6.3 ApprovalGates

Quando um step cria um gate de aprovação (ex: skill de risco médio/alto):
1. Missão vai para `paused`
2. Gate aparece no painel Missões
3. Aprovar no painel → missão retoma automaticamente

```bash
# Ou via API
POST /v2/approvals/:id/approve
{ "approvedBy": "marcelo", "comment": "Aprovado após revisão" }
```

### 6.4 Completar manualmente (caso de emergência)

```bash
# Se a missão ficou travada em paused:
POST /v2/missions/:missionId/execute   # volta para active
# auto-chain completa quando todos os steps forem terminais
```

---

## 7. Benchmark Engine (Fase 1)

Motor de avaliação de fitness para estratégias de prompt.

### Endpoints

| Endpoint | O que faz |
|---|---|
| `POST /v2/benchmark/extract` | Extrai casos candidatos a partir de TraceSpans recentes |
| `POST /v2/benchmark/run` | Roda benchmark de uma estratégia contra os casos cadastrados |
| `GET /v2/benchmark/cases` | Lista casos (filtros: taskType, approvedOnly, limit) |
| `GET /v2/benchmark/golden` | Retorna golden set (casos aprovados) |
| `PATCH /v2/benchmark/cases/:id/approve` | Aprova um caso para o golden set |
| `GET /v2/benchmark/strategy/:id` | Histórico de resultados de uma estratégia |

### Fitness formula

```
fitness = accuracy × 0.7 + (1 − cost_norm) × 0.15 + (1 − latency_norm) × 0.15
```

### Alimentar com casos manuais (quando trace_spans estiver vazio)

```sql
-- Via SSH: docker exec rayzen-ai-postgres-1 psql -U rayzen -d rayzen_ai
INSERT INTO v2.benchmark_cases (id, task_type, input, expected, source, approved, created_at)
VALUES (gen_random_uuid()::text, 'classify', '<input>', '<expected>', 'manual', true, now());
```

**Task types suportados:** `context_synthesis`, `classify`, `summarize` (e qualquer string — o Evolutionary usa o mesmo campo para selecionar estratégias).

**Estado atual:** 7 casos manuais inseridos em 2026-06-24 como seed inicial. Quando o Langfuse acumular traces com `attributes.prompt`/`attributes.response`, usar `POST /v2/benchmark/extract` para enriquecer automaticamente.

---

## 8. QA Scientist (Fase 5)

Loop autônomo de melhoria contínua de prompts. Roda automaticamente 10 min após boot e a cada 24h.

### Ciclo diário

1. **Coleta falhas** — steps com status `failed`/`skipped` (últimos 7 dias), benchmark results com fitness < 0.5, trace spans com status `error`
2. **Analisa com LLM** — identifica padrão, formula hipótese em PT-BR
3. **Decide se experimenta** — `isPropQualityIssue: true` → cria estratégia candidata e roda benchmark; `false` (infra/config) → registra hipótese mas não experimenta
4. **Cria gate de promoção** se Δfitness > 0.02

### Endpoints

| Endpoint | O que faz |
|---|---|
| `POST /v2/qa-scientist/run` | Dispara ciclo manual para um projeto `{ projectId }` |
| `POST /v2/qa-scientist/run-all` | Dispara para todos os projetos no catálogo |
| `GET /v2/qa-scientist/hypotheses` | Lista hipóteses (filtros: `projectId`, `status`, `limit`) |
| `GET /v2/qa-scientist/hypotheses/:id` | Detalhe de hipótese (inclui `report` em markdown) |
| `PATCH /v2/qa-scientist/hypotheses/:id/reject` | Rejeita hipótese manualmente |

### Status de hipóteses

| Status | Significado |
|---|---|
| `active` | Identificada, aguardando decisão |
| `experimenting` | Experimento em andamento |
| `promoted` | Δfitness > 0.02 — gate de promoção criado |
| `rejected` | Rejeitada manualmente |

### Filtragem de ruído de infra

Falhas `jarvis:*` por agent desktop offline geram `output.abortReason = "skill_repeated_failure:jarvis:*"`. O QA Scientist ignora esses sinais automaticamente — não cria hipóteses de infra repetidas.

---

## 9. Checkpoint — sincronização do ProjectState

O checkpoint mantém o Rayzen "em dia". Ao disparar (botão CHECKPOINT, ou automático a cada 2h / 15+ eventos), ele:

1. Sintetiza a sessão (resumo, decisões, próximos passos)
2. Refaz o ProjectState (via LLM) — objetivo, stage, blockers, milestones
3. Regenera os 5 docs da Documentação viva
4. Atualiza o Universe

Sem checkpoint, o ProjectState congela no último. **Se os painéis parecem velhos → falta checkpoint.**

---

## 10. Protocolo de sessão Claude Code ↔ Rayzen

### Contexto automático (não requer ação)
O hook `UserPromptSubmit` injeta o estado do projeto em cada prompt automaticamente (cache 5 min). Não é necessário chamar `rayzen_get_resume` em toda sessão.

### Quando usar MCP manualmente

| Situação | Tool |
|---|---|
| Início de task complexa (implementação / debugging) | `rayzen_get_context(mode, query)` |
| Decisão significativa tomada | `rayzen_add_event(intent:'decision', content:'...')` |
| Fim de sessão com código real modificado | `rayzen_checkpoint()` |
| Resolveu um problema não-trivial | `rayzen_capture_learning(...)` ← **o mais importante** |

### `rayzen_capture_learning` — o loop de write-back

Chame **depois de resolver um problema** para que o aprendizado persista e reapareça automaticamente nas próximas sessões.

```typescript
rayzen_capture_learning({
  title: "Deploy Rayzen AI no servidor local",
  problem: "O que quebrou / o sintoma observado",
  solution: "Como foi resolvido — passos concretos",
  type: "runbook",   // runbook | troubleshooting | decision | pattern | gotcha
  tags: ["deploy", "docker"],
  projectId: "<id>"
})
```

**Quando chamar:**
- Consertou algo que quebrou (deploy, bug, config, auth)
- Tomou uma decisão de arquitetura relevante
- Descobriu um gotcha que vai repetir
- Criou um runbook (passo a passo que vai repetir)

A pergunta-guia: *"Daqui a 2 meses, quero que o Rayzen já saiba isso?"* — Se sim, capture. Se não, pule.

---

## 11. MCP — tools disponíveis

O MCP HTTP (`https://rayzen.com.br/mcp`) expõe o Rayzen como conector OAuth. Autenticação com senha admin.

| Tool | O que faz |
|---|---|
| `rayzen_get_context` | Contexto cirúrgico por modo (implementation/debugging/review/architecture/study) + query semântica |
| `rayzen_get_resume` | Snapshot do ProjectState atual |
| `rayzen_get_goal` | Meta ativa + critérios + KPIs |
| `rayzen_add_event` | Registra decisão, ideia ou problema manualmente |
| `rayzen_checkpoint` | Dispara checkpoint (sintetiza sessão + regenera docs) |
| `rayzen_capture_learning` | Grava runbook/troubleshooting indexado na memória |
| `rayzen_search_memory` | Busca semântica na memória do projeto |
| `rayzen_get_wiki` | Consulta página da wiki por slug |
| `rayzen_update_planning` | Atualiza backlog e milestones |
| `rayzen_blueprint_import` | Importa blueprint/plano externo para o Rayzen |

---

## 12. Telegram — conversar e aprovar pelo celular

Funcional desde 14/09. Antes disso **todo texto livre devolvia "erro ao processar mensagem"** (o
orquestrador era chamado sem credencial), e só os comandos funcionavam.

### Primeiro uso, na ordem

| # | onde | o quê |
|---|---|---|
| 1 | @BotFather | `/setprivacy` → escolher o bot → **Disable** |
| 2 | chat privado com o bot | `/projeto` → responder o número |
| 3 | qualquer mensagem | conversa livre, já com o contexto do projeto |

O passo 1 **não é opcional para grupos**: com o *Group Privacy* ligado, o bot só recebe
`/comandos`, respostas diretas a ele e menções — texto livre num grupo ou tópico simplesmente não
chega, e o sintoma é indistinguível de bot quebrado.

### Organizando por projeto

A chave do vínculo é `(chat, tópico)`, o que permite três arranjos:

| arranjo | resultado |
|---|---|
| conversa privada | um chat = um projeto |
| grupo simples | um grupo = um projeto |
| **supergrupo com Tópicos** | **um tópico por projeto** |

Para liberar um grupo novo:

1. criar o grupo (ativando **Tópicos** nas configurações, se quiser um por projeto) e adicionar o bot
2. mandar qualquer mensagem lá — o bot registra o grupo como pendente **e avisa você no chat raiz**
3. no **chat privado**, `/autorizar` → escolher pelo número
4. em **cada tópico**, `/projeto` → escolher o projeto

> `/autorizar` só funciona a partir do chat raiz (`TELEGRAM_CHAT_ID`). É a barreira que impede um
> estranho que descubra o bot de alcançar o orquestrador — um grupo autorizado não pode autorizar
> outro.
>
> Enquanto não autorizado, o bot **não responde nada** naquele chat, nem a comandos. Isso é
> proposital; o aviso no chat raiz existe para você saber que há algo a decidir.

### Comandos

```
/projeto     — selecionar o projeto ativo daquele chat/tópico
/status      — estado atual do projeto
/goal        — meta ativa e progresso
/eventos [n] — últimos N eventos (padrão 10)
/checkpoint  — disparar checkpoint de sessão
/autorizar   — liberar um grupo novo (só no chat raiz)
/ajuda       — a lista acima
```

Qualquer outro texto vai para o orquestrador, com o contexto do projeto vinculado.

### Aprovar uma sessão supervisionada pelo celular

Quando uma sessão pausa para aprovação, o bot pergunta e **espera**. Responder ali decide a etapa.

- **Silêncio não aprova.** A sessão para e avisa; o trabalho fica no branch.
- Com **mais de uma** sessão aguardando, ele **não adivinha**: pede desambiguação, e você
  responde com o id curto na frente — `a1b2c3d4: pode continuar`.
- Comando tem precedência: `/projeto` continua sendo comando mesmo com sessão aguardando.

> Isso depende do **agent desktop rodando** (`rayzen-start.bat`) — é ele quem executa a sessão.
> Com o PC desligado, a criação da sessão falha na hora, com mensagem explícita, em vez de ficar
> pendurada.

---

## 13. Hermes — a camada de conversa

Spike validado em 13-14/09. Roda em container separado no servidor
(`infra/hermes/docker-compose.hermes.yml`), fala com o Rayzen por **MCP somente-leitura** (9
ferramentas) e usa o LiteLLM como provedor.

```bash
# subir / recriar (compose separado — NÃO entra no deploy automático)
docker compose -f infra/hermes/docker-compose.hermes.yml --env-file .env up -d --force-recreate --build

# conversar (não-interativo)
docker exec rayzen-hermes-spike hermes -z "sua pergunta"

# sessões e retomada
docker exec rayzen-hermes-spike hermes sessions list
docker exec rayzen-hermes-spike hermes --resume <id> -z "continuando…"
```

**Antes de qualquer `up` manual no servidor**, confira `ps aux | grep rayzen-deploy.sh` — o
`flock` do deploy protege o script dele mesmo, não de um comando manual concorrente.

O que ele **não** faz: executar ações no seu PC. Isso é do caminho Telegram/web → `jarvis` →
agent desktop. O Hermes conversa e consulta.

---

## 14. A identidade do Rayzen

Uma só, em **`core/identity/rayzen.soul.md`**, lida pelos dois runtimes: a imagem da api a copia
(orquestrador do Telegram e da web) e o Hermes a monta por bind `:ro`.

Para mudar como o Rayzen se comporta ou fala, **é esse o arquivo**. Ele vai inteiro no system
prompt de toda conversa, então cada parágrafo custa em todo turno.

> `core/identity/SOUL.md` (sem o `rayzen.`) **não** é a identidade — descreve a arquitetura, é de
> 15/06 e nenhum runtime o lê. Tem aviso no topo.
>
> `rayzen.config.json` → `identity.personality` virou **fallback**: só é usado se o SOUL não for
> encontrado, e o orquestrador avisa alto no log quando isso acontece.

## 15. Comandos úteis

```bash
# Desenvolvimento local
pnpm dev:api          # API V1 → :3101
pnpm dev:web          # Web → :3100
pnpm --filter api db:generate    # após mudança no schema Prisma V1
pnpm --filter api-v2 db:generate # após mudança no schema Prisma V2

# Qualidade
pnpm --filter api test          # 220 testes unitários
pnpm --filter api test:e2e
pnpm typecheck
pnpm gen:catalog      # docs/agent-actions.md (ações + risco)
pnpm scan:secrets     # docs/security/data-inventory.md

# Deploy no servidor (via SSH)
ssh -i C:/Users/marce/.ssh/id_ed25519 rayzen@servidor-local
# dentro do servidor:
cd ~/projects/rayzen-ai && git pull && docker compose up -d --build <serviço>
# serviços: api | api-v2 | web | mcp-http | agent-server

# Acesso direto ao banco (V2)
docker exec rayzen-ai-postgres-1 psql -U rayzen -d rayzen_ai
# schemas: public (V1) · v2 (V2) · langfuse
```

**Pré-requisito deploy:** usuário `rayzen` no grupo `docker` (sem sudo).
```bash
sudo usermod -aG docker rayzen   # logout+login para ter efeito
```

> **Atenção:** portas 3101 e 3103 **não são acessíveis diretamente** do PC — toda chamada API de diagnóstico deve ir via SSH.

---

## 16. Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Hook não pega / badge 🔴 | API fora ou `repoSlug` errado | Verifique `GET /events/hook/health`; confira remote git do projeto |
| Doc viva / Próximas ações desatualizadas | Faltou checkpoint | Dispare checkpoint |
| Goal Graph mostra "Nenhuma meta ativa" mas existiam metas | — | Normal — metas conquistadas agora aparecem automaticamente como "Metas anteriores" |
| MCP pede re-auth | Token expirado | Reconnect no Claude → login com senha admin |
| Evento vinculado ao projeto errado | Cache de slug | Limpe `%TEMP%\rayzen-slug-cache.json` |
| `rayzen_capture_learning` não retorna em `rayzen_get_context` | `projectId` não foi passado | Passe o `projectId` correto na chamada |
| Deploy falha com "sudo required" | Usuário não está no grupo docker | `sudo usermod -aG docker rayzen` + logout+login |
| Step de missão com specialist falha — `abortReason: skill_repeated_failure:jarvis:*` | Agent desktop não está rodando | Rode `rayzen-start.bat`; após 3 falhas o specialist para automaticamente |
| Step de missão falha com `V1 dispatch failed: HTTP 500` | Agent desktop offline ou ação não na whitelist | Ver o corpo do erro no `output.result` do step para causa exata |
| Missão travada em `paused` após gate | Gate aprovado mas execute não chamado | `POST /v2/missions/:id/execute` para retomar |
| `POST /v2/benchmark/extract` retorna 0 | `v2.trace_spans` vazia | Inserir casos manuais via SQL (ver Seção 7) |
| QA Scientist cria hipóteses duplicadas de infra | Sinais jarvis não filtrados (versão antiga) | Atualizar para commit ≥ `4739372`; sinais `skill_repeated_failure:jarvis:*` são ignorados |
| Build Docker falha com "crc32 mismatch" | Layer corrompida no cache | `docker builder prune` no servidor + rebuild |

---

## 17. Referências no repo

- `CLAUDE.md` / `CLAUDE.local.md` — guia de desenvolvimento e protocolo de sessão
- `blueprints/` — design da V2 (24 documentos, referência arquitetural)
- `docs/agent-actions.md` — catálogo de ações do agent (gerado por `pnpm gen:catalog`)
- `docs/security/data-inventory.md` — inventário de dados sensíveis (gerado)
- `memory/reference_vps_ssh.md` — acesso SSH ao servidor
- `C:\Users\marce\.claude\plans\agile-munching-catmull.md` — plano completo Fases 0–6
