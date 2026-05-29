# 014 — Human Approval Gates

## Visão Geral

Human Approval Gates são pontos de pausa obrigatória em missões que envolvem ações de alto risco ou decisões irreversíveis. O sistema pausa, notifica o usuário, aguarda aprovação e só continua (ou aborta) após resposta explícita.

Na V1 existe um proto-gate via `confirmation workflow` no Orchestrator e `dryRun` nas ações do agente. Na V2, gates são cidadãos de primeira classe no lifecycle de missões.

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `orchestrator` → `pendingAction` / `pendingDoc` | Pede confirmação antes de executar ações ou gerar docs |
| `apps/agent/src/executor.ts` → `dryRun` flag | Ações de médio/alto risco suportam `dryRun: true` |
| `ACTION_RISK` dict no orchestrator | Ações classificadas como low/medium/high risk |

**Problema na V1:** Gates são ad-hoc por módulo, sem persistência formal de aprovações, sem timeout com auto-reject, sem audit trail.

---

## Gaps

- `ApprovalGate` model com status, expiração e audit trail
- Gates linkados a steps de missão (gate bloqueia step até aprovação)
- Notificação ao usuário quando gate é aberto (Event + futuramente push notification)
- Timeout configurável: gate expirado sem resposta → auto-reject ou auto-approve por política
- Audit trail: quem aprovou, quando, com qual comentário
- Gates por tipo: `code_deploy`, `data_write`, `external_api`, `irreversible_action`

---

## Interface / Endpoints

```
GET  /v2/approvals/pending          # Lista gates aguardando aprovação
POST /v2/approvals/:id/approve      # Aprova gate
POST /v2/approvals/:id/reject       # Rejeita gate (com motivo)
GET  /v2/approvals/:id              # Detalhes do gate
GET  /v2/approvals/history          # Histórico de aprovações do projeto
```

---

## Modelo de Dados

```typescript
type ApprovalGateType =
  | 'code_deploy'        // deploy de código em produção
  | 'data_write'         // escrita em banco de dados
  | 'external_api'       // chamada para API externa com efeito colateral
  | 'irreversible'       // ação sem rollback possível
  | 'high_cost'          // operação com custo estimado alto
  | 'specialist_spawn'   // instanciar especialista autônomo

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

interface ApprovalGate {
  id:           string
  projectId:    string
  missionId:    string
  stepId:       string
  type:         ApprovalGateType
  description:  string
  context:      Record<string, unknown>   // o que será executado
  status:       ApprovalStatus
  expiresAt:    Date
  autoOnExpiry: 'reject' | 'approve' | 'pause'
  approvedBy?:  string
  approvedAt?:  Date
  comment?:     string
  createdAt:    Date
}
```

**Política de gates por risco:**
```typescript
const GATE_POLICY: Record<SkillRisk, ApprovalGateType | null> = {
  'none':   null,          // sem gate
  'low':    null,          // sem gate (dryRun opcional)
  'medium': 'data_write',  // gate com timeout 30 min, auto-reject
  'high':   'irreversible',// gate sem auto-approve, manual obrigatório
}
```

---

## Dependências

- **001 — Mission Engine**: gate pausa step, missão fica em `paused` aguardando
- **006 — Skill Engine**: skills com `risk: 'high'` criam gate antes de executar
- **011 — Specialists**: instanciação de especialistas de alto risco requer gate
- **010 — Observability**: aprovações ficam no audit trail com trace

---

## Fase de Implementação

**Fase 3** — após Skill Engine e Mission Engine estáveis.

Ordem:
1. `ApprovalGate` model (migration Prisma)
2. `ApprovalGateService` com create/approve/reject/expire
3. Integração no Mission Engine: step em `risk: 'high'` abre gate antes de executar
4. Integração no Skill Engine: skills high-risk verificam gate
5. Timeout job (BullMQ, verifica gates expirados a cada minuto)
6. Notificação via Event + push (Fase 4)
