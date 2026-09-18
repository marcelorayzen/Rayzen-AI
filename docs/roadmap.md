# ROADMAP — Rayzen AI

> Estado atual do projeto e direções futuras. Atualiza a versão V1-only (Fases 1-14 + Polimento).

---

## Estado atual

### V1 — Todas as 14 fases concluídas

| Fase | O que foi | Status |
|---|---|---|
| Fase 1 — Project-aware | projects CRUD, project_id em mensagens/docs | ✅ |
| Fase 2 — Event log | `events` com source/type/intent | ✅ |
| Fase 3 — Hooks Claude Code | PostToolUse + Stop → /events/cli | ✅ |
| Fase 4 — Síntese de sessão | `session_artifacts`, trigger no Stop | ✅ |
| Fase 5 — Documentação viva | 5 tipos de doc gerados por LLM | ✅ |
| Fase 6 — Obsidian export | sync + deep links + conflict detection | ✅ |
| Fase 7 — Estado estruturado | `project_states` com milestones/backlog/activeFocus | ✅ |
| Fase 8 — Confiança e rastreabilidade | versões de doc + diff + sourceIds | ✅ |
| Fase 9 — Git-aware context | branch + commits na síntese | ✅ |
| Fase 10 — Inteligência proativa | 7 regras, `ProactiveService` | ✅ |
| Fase 11 — Planejamento operacional | resume brief, painel agora/depois/bloqueado | ✅ |
| Fase 12 — Health score | score 0-100, 6 dimensões, histórico 30 dias | ✅ |
| Fase 13 — Memória hierárquica | memory_class inbox→archive, filtro na síntese | ✅ |
| Fase 14 — Work modes | 5 modos, systemPromptSuffix, synthesisFocus | ✅ |
| Polimento & Segurança | SEC-1→12, CacheModule, Prometheus, CI, Blueprint | ✅ |

### V2 — Mission Oriented Engineering System

| Fase | Commits | Status |
|---|---|---|
| V2 real end-to-end | `64b6870`, `8d369c2`, `b1fca41`, `b523a5d` | ✅ |
| Fase 1 — Benchmark Engine | `7f56633` | ✅ |
| Fase 2 — Agent Dialogue | `4049df4` | ✅ |
| Fase 3 — Evolutionary Prompting | `9fed27b` | ✅ |
| Fase 4 — Mem0 sidecar | ⏭️ Pulada — imagem não existe no Hub | ✅ (skip) |
| Fase 5 — QA Scientist | `72a1176`, `c16aeee` | ✅ |
| StepExecutor robustez | `f212e1b`, `f7dc47d` | ✅ |
| Fase 0-A — role-policy drift | `6ade5fe`, ADR-002 | ✅ |
| Specialist `researcher` | `1683e7e`, `d85135b`, `d675f29`, `7a09275` | ✅ |
| BenchmarkCases (46 casos, medidos no banco em 2026-08-07) | `6ade5fe` | ✅ |
| Rayzen Guardian — vigilância proativa (`apps/api-v2/src/guardian/`) | risk scoring aditivo, TestGapDetector, cache tmpdir, pre-push block em critical | ✅ |
| `SpecialistRegistry.infer()` sob teste | 55 casos; expôs e corrigiu o branch `tester` só-inglês (steps pt-BR sobre teste caíam no coder) | ✅ |
| Ciclo do QA Scientist rodando ponta a ponta | Confirmado ao vivo em 2026-08-07 18:15: sinal → hipótese → experimento → `BenchmarkResult` → gate de promoção. Rodou sobre dado ruim (ver abaixo), mas a mecânica fecha | ✅ |
| Benchmark roda em free tier | Retry em 429 honrando o tempo que o servidor informa. 46/46 casos concluídos, `skipped: 0`, onde antes eram 46/46 falhas | ✅ |

---

## Backlog pendente (prioridade)

### Alta prioridade

| Item | Contexto |
|---|---|
| **Crédito na Anthropic** | Bloqueia `gpt-4o-premium`: o specialist `architect` não roda. Suspeita de ser também o teto de `summarize` (0.628) e `context_synthesis` — o juiz 8b pune paráfrase correta que não copia a forma esperada |
| **Bateria CR2032 do servidor** | Relógio derrapou 8h43m em horas no dia 14/08, corrigido pelo NTP sozinho. Até trocar, todo boot grava com data errada até a primeira sincronia. O invariante `relogio_sincronizado` agora avisa por conta própria (ciclo de 30min no servidor) |
| **Purga dos health checks do Langfuse** | 149.006 de 159.415 traces (93,5%) são a sonda do LiteLLM, todas com o mesmo input sintético e sem projeto. A fonte foi corrigida em 13/08. Filtro seguro: `name LIKE '%health%'` — **nunca** "traces sem nome": 10.316 anônimos são trabalho real de antes da instrumentação de 14/08 |

> Saíram daqui em 2026-08-15, todos verificados no banco: semear estratégias do evolutionary ·
> refazer os BenchmarkCases · fitness de junho como linha de base · confirmar traces de
> specialists no Langfuse.

### Média prioridade

| Item | Contexto |
|---|---|
| `researcher` com paginação automática de arquivo | Instrução no system prompt existe; validar com arquivo > 300 linhas |
| Workspace watcher agnóstico | Capturar edits fora do Claude Code (VS Code, Codex) |
| Grafana sobre Prometheus | Dashboard de latência/custo hoje consultado manualmente via `/metrics` |
| ~~Purge de `agent_audit_logs`~~ | **Removido do escopo em 15/08**: 449 linhas e **zero escritas em 30 dias**. A tabela está dormente desde junho — política de retenção onde ninguém escreve não resolve nada |
| UI para gate de clarificação | Gates sem missão já se resolvem em `/guardian` (06/ago); falta o de clarificação dentro de missão, ainda só por API |

### Baixa prioridade / decisão futura

| Item | Espera por |
|---|---|
| **Fase 6 — Mastra + AG-UI** | StepExecutor mostrar limitação real não coberta (streaming, replanning dinâmico, AG-UI) |
| Fase 0-A — drift `supervised_session` | Verificar se implementação real ainda necessita de ajuste (ADR-001 existente) |
| Cross-project knowledge | Múltiplos projetos com knowledge graph estável |
| Widget Electron/Tauri | Ciclo 3-B — pós-estabilização V2 |
| Multi-agent (além de specialist types) | Consolidar work modes V1 + V2 antes |

---

## Princípios do roadmap

- **Captura é fácil** — zero fricção para registrar atividade
- **Consolidação é assíncrona** — síntese em background, não bloqueia trabalho
- **Publicação é revisável** — nenhum artefato publicado sem possibilidade de revisão humana
- **Automação é auditável** — toda ação da IA aparece na timeline e nos audit logs
- **Simples antes de inteligente** — regras explícitas antes de ML; regex antes de embedding para inferência
- **Execução fecha o loop** — memória sem plano é arquivo; plano sem execução é wishlist

---

## Definição de "done" para estabilização V2

> O sistema V2 está estável quando:
> 1. Missão de 3 steps executa end-to-end sem intervenção manual (specialist correto inferido, prevOutputs fluindo, missão marcada `done`)
> 2. QA Scientist roda ciclo 24h e gera `BenchmarkResult` com fitness > 0.6 em pelo menos 2 taskTypes
> 3. Traces dos specialists visíveis no Langfuse para cada missão executada
> 4. `StepExecutorService` e `SpecialistRegistry.infer()` com cobertura de testes automatizados

**Status medido em 2026-08-15** (contra o banco, não contra anotação): **4 de 4.**
1. ✅ Missão de 3 steps end-to-end
2. ✅ Fitness > 0.6 em 2 taskTypes — `classify` 0.918, `classify_event` 0.645, `summarize` 0.628.
   O que destravou não foi refazer o conjunto: o prompt de `summarize` não declarava a convenção
   de formato que os casos esperavam, e `classify` misturava duas tarefas diferentes — separadas
   em `classify` e `classify_event`. `classify` foi de 0.474 para 0.918 sem tocar num único caso
3. ✅ Traces dos specialists no Langfuse — verificado em 2026-08-15 rodando um `reviewer` isolado
   por `POST /v2/specialists/spawn`: 5 traces `rayzen:specialist:reviewer`, um por iteração
4. ✅ `StepExecutorService` e `SpecialistRegistry.infer()` com spec

> O critério 3 não exigia descongelar o executor de missões: `spawn` roda um specialist sozinho.
> Escolher o `reviewer` foi deliberado — skills só de leitura e modelo Groq, sem tocar a Anthropic.

---

## Fase 6 — Mastra + AG-UI (condicional)

**Entrar quando:**
- StepExecutor atual mostrar limitação real (streaming de saída passo a passo, replanning dinâmico de steps, UI AG-UI para acompanhar o agente em tempo real)
- Não antes — a arquitetura atual de polling + BullMQ resolve os casos de uso atuais

**O que seria:**
- Mastra como runtime de agente com streaming nativo
- AG-UI protocol para stream de eventos do agente para a UI
- Substituição gradual do `SpecialistModule` por Mastra agents
