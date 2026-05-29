# 023 — Web Interface V2

## Visão Geral

O `apps/web` existente ganha novas seções para expor a arquitetura V2 ao usuário. Não é um novo app — é uma evolução do painel atual com quatro novas rotas principais: `/mission`, `/knowledge`, `/vault`, `/observability`. O painel de chat e as seções V1 continuam funcionando em paralelo.

---

## Novas rotas

```
/mission          → criar, listar e acompanhar missões
/mission/:id      → detalhe de missão: steps, progresso, timeline, custo
/knowledge        → grafo de conhecimento do projeto ativo
/vault            → gerenciar segredos (nomes — nunca valores)
/observability    → traces, métricas, custo acumulado
```

---

## `/mission` — Painel de Missões

O painel central da V2. Permite:
- Criar nova missão a partir de um objetivo em linguagem natural
- Ver missões ativas, pausadas, concluídas
- Acompanhar progresso em tempo real (steps com status)
- Aprovar Human Approval Gates pendentes

```
┌─────────────────────────────────────────────────────┐
│  Missões                            [+ Nova Missão]  │
├─────────────────────────────────────────────────────┤
│  ● Sistema Restaurante    ACTIVE   Step 3/7   42%   │
│  ◉ VB Ferragens Deploy    WAITING  Aguardando        │
│    aprovação: executar deploy                        │
│  ✓ Análise de impacto     DONE     Concluída         │
└─────────────────────────────────────────────────────┘
```

**Detalhe de missão (`/mission/:id`):**
```
┌─────────────────────────────────────────────────────┐
│  Sistema Restaurante — ACTIVE                       │
│  Custo: $0.42    Tempo: 8min    Tokens: 12.4k       │
├─────────────────────────────────────────────────────┤
│  ✓ context        2.1s    AI (Haiku)    $0.02       │
│  ✓ plan           4.3s    AI (Sonnet)   $0.18       │
│  ● implement      running  Skill         —           │
│  ○ test           pending  —             —           │
│  ○ review         pending  —             —           │
│  ○ document       pending  —             —           │
└─────────────────────────────────────────────────────┘
```

---

## `/knowledge` — Knowledge Graph

Visualização do grafo de conhecimento do projeto ativo. Reusa o componente `@xyflow/react` já existente no GraphCanvas (usado pelo Goal Graph na V1).

```
┌─────────────────────────────────────────────────────┐
│  Knowledge Graph — VB Ferragens      [Rebuild] [?]  │
│                                                     │
│   [Produto] ──contém──→ [Categoria]                 │
│       ↓                                             │
│   [Estoque] ←──depende── [Pedido] ──→ [Cliente]     │
│                                                     │
│  Filtros: □ módulos  □ entidades  □ regras  □ ADRs   │
└─────────────────────────────────────────────────────┘
```

---

## `/vault` — Gerenciador de Segredos

Interface para adicionar, listar e remover segredos. **Nunca exibe valores** — apenas nomes e metadados.

```
┌─────────────────────────────────────────────────────┐
│  Vault — VB Ferragens                [+ Adicionar]  │
├─────────────────────────────────────────────────────┤
│  supabase      •••••••••   há 3 dias    [Remover]   │
│  vercel        •••••••••   há 1 hora    [Remover]   │
│  telegram      •••••••••   há 7 dias    [Remover]   │
├─────────────────────────────────────────────────────┤
│  Scanner: ✓ Nenhum segredo exposto encontrado       │
└─────────────────────────────────────────────────────┘
```

---

## `/observability` — Observabilidade

Visão consolidada de saúde do sistema V2.

```
┌────────────────┬────────────────┬────────────────────┐
│ Missões hoje   │ Custo (mês)    │ Tokens (mês)       │
│ 12 completas   │ $2.14          │ 184k               │
│ 2 ativas       │ budget: $20    │                    │
│ 1 com erro     │ ██████░ 10.7%  │                    │
└────────────────┴────────────────┴────────────────────┘

Últimas missões com erro:
  ● VB Deploy  Step 4: timeout after 30s  [Ver trace]
```

---

## Mapeamento V1 → V2 no web

| V1 | V2 |
|---|---|
| `/` — chat + painel principal | Mantido — V1 continua funcionando |
| Painel "grafo" (Goal Graph) | Mantido + `/knowledge` usa o mesmo componente canvas |
| Painel "Brain" | Mantido — memória V1 |
| Sem missões | Novo: `/mission` |
| Sem vault | Novo: `/vault` |
| Sem observability centralizada | Novo: `/observability` |

---

## Dependências

- `apps/api-v2/` — consume endpoints V2 (`/v2/missions`, `/v2/knowledge`, `/v2/vault`, `/v2/observe`)
- `apps/api/` — endpoints V1 continuam sendo consumidos pelas seções existentes
- `@xyflow/react` — já instalado, reusado no Knowledge Graph
- Componente `GraphCanvas.tsx` existente — adaptado para o Knowledge Graph

---

## Fase de Implementação

**Fase 3** — após Mission Engine, Skill Engine e Memory Engine estáveis.

Ordem:
1. `/mission` — listagem e criação (MVP: objetivo → missão)
2. `/mission/:id` — detalhe com steps em tempo real (SSE ou polling)
3. Aprovação de Human Approval Gates via web
4. `/vault` — listagem e adição de segredos
5. `/knowledge` — grafo básico (reusa GraphCanvas)
6. `/observability` — custo + erros + traces
