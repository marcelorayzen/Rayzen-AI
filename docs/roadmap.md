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
| BenchmarkCases (22 casos) | `6ade5fe` | ✅ |
| Rayzen Guardian — vigilância proativa (`apps/api-v2/src/guardian/`) | risk scoring aditivo, TestGapDetector, cache tmpdir, pre-push block em critical | ✅ |

---

## Backlog pendente (prioridade)

### Alta prioridade

| Item | Contexto |
|---|---|
| Testes unit para `StepExecutorService` | Motor de missões sem cobertura automatizada — validado só manualmente |
| Testes unit para `SpecialistRegistry.infer()` | Regressões de inferência detectadas em produção (spec/specialist, inspect/tester) |
| Alimentar BenchmarkCases via `/extract` | 22 casos manuais; fitness do QA Scientist não é representativo — extrair de Traces |
| Confirmar traces de specialists no Langfuse | Objetivo original da missão de stress test ainda não verificado explicitamente |

### Média prioridade

| Item | Contexto |
|---|---|
| `researcher` com paginação automática de arquivo | Instrução no system prompt existe; validar com arquivo > 300 linhas |
| Workspace watcher agnóstico | Capturar edits fora do Claude Code (VS Code, Codex) |
| Grafana sobre Prometheus | Dashboard de latência/custo hoje consultado manualmente via `/metrics` |
| Purge de `agent_audit_logs` | Sem TTL — crescimento ilimitado |
| UI para ApprovalGates | Gate de clarificação hoje aprovado via API; falta fluxo na UI |

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

**Status atual:** critério 1 ✅, critérios 2/3/4 pendentes.

---

## Fase 6 — Mastra + AG-UI (condicional)

**Entrar quando:**
- StepExecutor atual mostrar limitação real (streaming de saída passo a passo, replanning dinâmico de steps, UI AG-UI para acompanhar o agente em tempo real)
- Não antes — a arquitetura atual de polling + BullMQ resolve os casos de uso atuais

**O que seria:**
- Mastra como runtime de agente com streaming nativo
- AG-UI protocol para stream de eventos do agente para a UI
- Substituição gradual do `SpecialistModule` por Mastra agents
