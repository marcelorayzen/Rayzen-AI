# Rayzen AI — Manual de Uso

> Manual operacional + arquitetura. Como o Rayzen funciona hoje e como usá-lo no dia a dia.
> Última revisão: 2026-06-24 (Fases 1–3 concluídas; missões V2 funcionais).

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
┌─ Sua máquina (Windows) ──────────────┐     ┌─ Notebook local (Ubuntu · Docker) ────────┐
│ • VS Code + Claude Code               │     │ • PostgreSQL 16 + pgvector                 │
│ • Hook (rayzen-hook.mjs)  ───eventos──┼────▶│   schemas: public (V1) · v2 (V2) · langfuse│
│ • Agent desktop (agent-start.bat)     │◀────┼─ tarefas ─ • Redis 7 + BullMQ             │
│ • MCP stdio (.mcp.json)               │     │ • LiteLLM proxy (:4000)                    │
└───────────────────────────────────────┘     │ • API V1 (:3101) — uso diário              │
                                               │ • API V2 (:3103, prefixo /v2)              │
                                               │ • Web (:3100) · MCP HTTP (:3102)           │
                                               │ • Langfuse (:3200) — observabilidade LLM   │
                                               │ • Caddy + Cloudflare Tunnel (HTTPS)        │
                                               └───────────────────────────────────────────┘
```

- **Hook** = sensor passivo. Cada ação no Claude Code (Edit/Write/Bash) vira um evento no Rayzen.
- **Agent** = braço executor. Recebe tarefas (`jarvis:*`) e executa no SO local (whitelist obrigatória). **Requer agent-start.bat rodando** — sem ele, skills `jarvis:*` retornam 500.
- **MCP** = ponte para o Claude Code e claude.ai consultarem e gravarem no Rayzen.
- **Infra** = notebook local `192.168.0.174`, Cloudflare Tunnel para domínio `rayzen.com.br`.

### 2.2 Estado dos módulos V2

| Estado | Módulos |
|---|---|
| **Ativos** | `benchmark`, `evolutionary`, `agent-dialogue`, `context-engine`, `specialist-agent`, `approval-gates`, `knowledge`, `memory`, `mission`, `router`, `step-executor`, `mission-scheduler` |
| **Dependem do agent desktop** | `jarvis:git_log`, `jarvis:file_search`, `jarvis:run_command`, `jarvis:file_write` — retornam 500 sem agent rodando |

### 2.3 LiteLLM — mapeamento de modelos

| Alias | Modelo real |
|---|---|
| `gpt-4o` | Groq llama-3.3-70b (fallback Claude Sonnet) |
| `gpt-4o-mini` | Groq llama-8b |
| `gpt-4o-premium` | Claude Sonnet direto |

> Claude não suporta `response_format: json_object` — usar extração robusta (strip code fences + regex).

---

## 3. Setup diário

1. **Notebook ligado.** A stack (Postgres, Redis, LiteLLM, APIs, Web, MCP, Langfuse, Cloudflared) sobe sozinha com `restart: unless-stopped`.
2. **Agent desktop.** Na sua máquina, rode `agent-start.bat` — polling de tarefas `jarvis:*`. Sem ele, steps de missões que usam skills jarvis falham.
3. **VS Code + Claude Code.** Abra a pasta do projeto. O hook detecta o projeto pelo `git remote` e começa a capturar eventos.
4. **Web.** Abra `http://192.168.0.174:3100` (ou `https://rayzen.com.br`), selecione o projeto no topo.

### Diagnóstico rápido

```bash
# Status de todos os serviços (postgres, redis, litellm, api-v2, mcp, JWT)
GET http://192.168.0.174:3101/infra/health

# Langfuse (traces LLM)
http://192.168.0.174:3200
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
| **Goal Graph** | Meta do projeto, critérios, KPIs, progresso | **Só quando você edita** | Botão "EDITAR META" / "+ critério" |
| **Documentação viva** | 5 docs (estado, decisões, próximas ações, diário, evidências) | **No checkpoint** | Botão "Regenerar" / checkpoint |
| **Universe** | Canvas: docs, decisões e relações | **Manual** | Botão "atualizar" / "importar projeto" |
| **Brain / Memória** | Busca semântica na memória indexada | Ao indexar fontes | Painel Brain → indexar |
| **Missões** | Missões V2 ativas, steps, gates de aprovação | **Ao vivo via WebSocket** | Botão "missões" no Header |

**Regra:** se um painel parece desatualizado, quase sempre é porque não atualiza sozinho — depende de checkpoint (Doc viva) ou edição manual (Goal Graph). Só a Atividade e Missões são ao vivo.

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
POST /v2/approve/:gateId
{ "approved": true, "comment": "Aprovado após revisão" }
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

## 8. Checkpoint — sincronização do ProjectState

O checkpoint mantém o Rayzen "em dia". Ao disparar (botão CHECKPOINT, ou automático a cada 2h / 15+ eventos), ele:

1. Sintetiza a sessão (resumo, decisões, próximos passos)
2. Refaz o ProjectState (via LLM) — objetivo, stage, blockers, milestones
3. Regenera os 5 docs da Documentação viva
4. Atualiza o Universe

Sem checkpoint, o ProjectState congela no último. **Se os painéis parecem velhos → falta checkpoint.**

---

## 9. Protocolo de sessão Claude Code ↔ Rayzen

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
  title: "Deploy Rayzen AI no notebook local",
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

## 10. MCP — tools disponíveis

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

## 11. Comandos úteis

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

# Deploy no notebook (via SSH)
ssh -i C:/Users/marce/.ssh/id_ed25519 rayzen@192.168.0.174
# dentro do notebook:
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

## 12. Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Hook não pega / badge 🔴 | API fora ou `repoSlug` errado | Verifique `GET /events/hook/health`; confira remote git do projeto |
| Doc viva / Próximas ações desatualizadas | Faltou checkpoint | Dispare checkpoint |
| Goal Graph com meta velha | Meta é manual | Edite a meta no painel |
| MCP pede re-auth | Token expirado | Reconnect no Claude → login com senha admin |
| Evento vinculado ao projeto errado | Cache de slug | Limpe `%TEMP%\rayzen-slug-cache.json` |
| `rayzen_capture_learning` não retorna em `rayzen_get_context` | `projectId` não foi passado | Passe o `projectId` correto na chamada |
| Deploy falha com "sudo required" | Usuário não está no grupo docker | `sudo usermod -aG docker rayzen` + logout+login |
| Step de missão com specialist falha (500) | Agent desktop não está rodando | Rode `agent-start.bat` antes de executar missões com steps `ai` |
| Missão travada em `paused` após gate | Gate aprovado mas execute não chamado | `POST /v2/missions/:id/execute` para retomar |
| `POST /v2/benchmark/extract` retorna 0 | `v2.trace_spans` vazia | Inserir casos manuais via SQL (ver Seção 7) |
| Build Docker falha com "crc32 mismatch" | Layer corrompida no cache | `docker builder prune` no notebook + rebuild |

---

## Referências no repo

- `CLAUDE.md` / `CLAUDE.local.md` — guia de desenvolvimento e protocolo de sessão
- `blueprints/` — design da V2 (24 documentos, referência arquitetural)
- `docs/agent-actions.md` — catálogo de ações do agent (gerado por `pnpm gen:catalog`)
- `docs/security/data-inventory.md` — inventário de dados sensíveis (gerado)
- `memory/reference_vps_ssh.md` — acesso SSH ao notebook
- `C:\Users\marce\.claude\plans\agile-munching-catmull.md` — plano completo Fases 0–6
