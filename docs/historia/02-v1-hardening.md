---
capitulo: 2
titulo: "V1 — Hardening e Maturidade"
periodo: "2026-04-03 a 2026-05-18"
fontes:
  commits: ["8771517", "6a4125b", "a1e54c4", "b9bd5d9", "03df5ce", "bb99f0e", "9c9e2c4", "eea8847", "dfe1f56", "1e26bcb", "53084c0", "abfceaa", "d78338c", "1ac7239", "65973ac", "a297ac9", "4a78d5e", "c0b5c48", "f957311", "aa535a9", "9b657b6", "3f6331c", "30ed063", "455377e", "c4e9629", "95d232a"]
  docs: ["docs/diary.md", "docs/roadmap.md"]
  memory: []
confianca: "alta"
---

# Capítulo 2 — V1: Hardening e Maturidade

Este é o período de maior densidade de decisões estruturais concentradas em pouquíssimo tempo: **as 14 fases do V1 foram todas commitadas em um único dia**, 2026-04-05. O que vem depois, até 05-18, é a fase de maturidade — dar profundidade real (QA, dados, memória, grafo) ao que as 14 fases estabeleceram como esqueleto.

## As 14 fases (04-05) — o esqueleto de "projeto vivo"

Cada fase tem seu próprio commit `feat:`, na sequência exata: `8771517` (fase 1) → `6a4125b`/`7d4e7ad` (fase 2) → `a1e54c4` (fase 3) → `b9bd5d9` (fase 4) → `03df5ce` (fase 5) → `bb99f0e` (fase 6) → `9c9e2c4` (fase 7) → `eea8847` (fase 8) → `dfe1f56` (fase 9) → `1e26bcb` (fase 10) → `53084c0` (fase 11) → `abfceaa` (fase 12) → `d78338c` (fase 13) → `1ac7239` (fase 14). Segundo `docs/roadmap.md`:

| Fase | O que estabeleceu |
|---|---|
| 1 — Project-aware | CRUD de projetos, `project_id` em mensagens e docs |
| 2 — Event log | tabela `events` com `source/type/intent`, emissão automática |
| 3 — Hooks Claude Code | `PostToolUse` + `Stop` → `/events/cli` |
| 4 — Síntese de sessão | `session_artifacts`, disparado no `Stop` |
| 5 — Documentação viva | 5 tipos de doc gerados por LLM |
| 6 — Obsidian export | sync + deep links + detecção de conflito |
| 7 — Estado estruturado | `project_states` com milestones/backlog/activeFocus |
| 8 — Confiança e rastreabilidade | versões de doc + diff auditável + `sourceIds` |
| 9 — Git-aware context | branch + commits entrando na síntese |
| 10 — Inteligência proativa | 7 regras + `ProactiveService` |
| 11 — Planejamento operacional | resume brief, painel agora/depois/bloqueado |
| 12 — Health score | score 0-100 em 6 dimensões, histórico de 30 dias |
| 13 — Memória hierárquica | `memory_class` inbox→archive, filtro na síntese |
| 14 — Work modes | 5 modos (implementation/debugging/architecture/study/review), `systemPromptSuffix` |

O que essa sequência revela: o Rayzen não cresceu adicionando features soltas. Cresceu construindo, em ordem, as pré-condições para a próxima — não dava para ter "síntese de sessão" (fase 4) sem "event log" (fase 2); não dava para ter "inteligência proativa" (fase 10) sem "estado estruturado" (fase 7). O roadmap de hoje (`docs/roadmap.md`) ainda lista essas 14 fases como "✅ concluídas", sem revisão desde então — o esqueleto de 04-05 nunca precisou ser refeito.

## Brain, Wiki e as primeiras integrações (04-06 a 04-11)

Logo depois do esqueleto, dois saltos de capacidade:
- `8009e64` (04-06) — Notion, Mermaid, `run_tests`, `inspect_schema`, `PrismaService` global, confirmação de documento, unificação de voz.
- `65973ac` (04-11) — Brain + Wiki modules, indexador Notion, painel de memória, gestão de projetos.

Esses dois commits são o ponto em que o Rayzen deixa de ser só um chat com síntese e passa a ter uma camada de conhecimento persistente e consultável — o Brain (pgvector) e a Wiki (versionada) que sustentam toda a arquitetura V1 até hoje.

## Maio: QA, qualidade de dados e o Goal Graph

A partir de 05-04 (`6a2a476` — melhorias de import de memória e confirmação de ação), o ritmo muda de "construir o esqueleto" para "aprofundar módulo por módulo". Em uma única sequência de commits no dia **05-07**, quatro frentes avançaram em paralelo:

- **QA** — Fase 1.1 parser JUnit/Allure (`a297ac9`), Fase 1.2 detecção de flaky tests (`4a78d5e`), Fase 1.3 webhook CI/CD para ingest de report (`c0b5c48`).
- **Qualidade de dados** — Fase 2.1 regras e contratos de qualidade (`f957311`), Fase 2.2 alertas de mudança de schema (`aa535a9`).
- **Catálogo e lineage** — Fase 3.1+3.2, catálogo conversacional e lineage (`9b657b6`).
- **Compliance** — Fase 3.3, artefatos de conformidade LGPD (`3f6331c`).
- **Notion** — sync por projeto (`44a3f33`) e auto-criação de páginas de projeto a partir da página raiz (`d2b8339`).

No mesmo dia, ainda: hook de auto-indexação de arquivos editados no pgvector (`bad5b35`), auto-resolução de projeto por nome no hook sem precisar de UUID (`1b5e1b7`) — o início de uma dor recorrente (resolução de projeto por slug) que reaparece com mais gravidade no capítulo 5.

Entre 05-08 e 05-11, nasce o **Rayzen Goal Graph** (`30ed063`): meta vs. estado, gap analysis, `repoSlug` como chave. Em sequência rápida: `ffb9447` (auto-detect de repoSlug), `9f5b05b`/`19729b7` (substituição do Mermaid estático por React Flow — nós interativos), `3ce04ac`/`ece7411` (Fase 3 do grafo: KPI tracking, histórico de meta, alerta de estagnação, wizard de onboarding, CRUD de critérios), `7e81c85` (accordion de critérios no histórico).

Em 05-10, dois marcos paralelos: **`455377e`** — o primeiro Rayzen MCP Server, permitindo que o Claude leia e escreva no Rayzen durante a sessão (a base técnica de todo o protocolo Claude Code ↔ Rayzen usado neste próprio livro), e **`c4e9629`** — provider switcher de LLM (Groq/Claude) com dashboard de uso e custo, o embrião do Cost Controller que a V2 formalizaria depois.

Em 05-16/17, a separação de Agents por papel aparece pela primeira vez em código — `228cc34` (roteamento por role: notebook vs. desktop), `95d232a` (split formal desktop/server) — um dia antes da decisão ser formalizada no diário como parte da consolidação VPS (capítulo 3). No mesmo período, a dashboard de QA ganha resumo/tendência/histórico de runs (`2544335`) e os screenshots passam a se organizar por projeto com um template de manual de QA (`ad28cc7`).

## O que este capítulo estabelece para o resto da história

Três coisas que reaparecem em todos os capítulos seguintes nasceram aqui, sem alarde:
1. **O MCP Server** (`455377e`) — sem ele, não existiria o protocolo de sessão Claude Code ↔ Rayzen que hoje sustenta a própria escrita deste livro.
2. **O Goal Graph** (`30ed063`) — motor de gap analysis que, em junho, se torna palco de um dos bugs mais sutis do bugchain (capítulo 5): `toggleCriteria()` não emitindo evento de decisão.
3. **O split desktop/server dos Agents** (`95d232a`) — decisão que parece cosmética em maio, mas que gera três ADRs de drift de role-policy em junho (capítulo 5) quando a separação não foi propagada de forma consistente entre `whitelist.ts`, `execution.service.ts` e `role-policy.ts`.
