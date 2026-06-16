# RCP Service (Rayzen Commerce Platform)
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0

---

## Objetivo

Desenvolver e evoluir o Rayzen Commerce Platform — ERP/CRM/PDV/site multi-tenant para pequenos negócios — usando o próprio Rayzen como dogfood do ciclo missão→execução→entrega.

---

## Intenções cobertas

| IntentType | Descrição |
|---|---|
| `generate_code` | Features do RCP (admin, site, API, PDV) |
| `review_code` | Revisão de PR do RCP |
| `client_discovery` | Mapear necessidade de novo tipo de loja/tenant |
| `create_test` | Testes E2E e unitários do RCP |
| `generate_documentation` | README, ROADMAP, ADR do RCP |

---

## Agentes

- **code-agent** (primário) — gera features do RCP
- **business-agent** (suporte) — mapeia necessidade de tenant/cliente
- **qa-agent** (suporte) — cria e roda testes do RCP

---

## Stack do RCP

- Next.js 15 App Router + TypeScript
- Prisma + PostgreSQL (multi-tenant por `tenantId`)
- NextAuth v5 + RBAC (6 roles)
- Tailwind CSS
- Deploy: Vercel
- Repo: `github.com/marcelorayzen/rayzen-commerce-platform` (privado)
- projectId Rayzen: `5a2bc616-e232-414c-b716-6d530c020812`

---

## Versões e estado atual

| Versão | Status | Faltando |
|---|---|---|
| V1 — Site + Admin | 90% | Dashboard com métricas de receita |
| V2 — Gestão Comercial | em andamento | CRM: estimatedValue + funil · Estoque: fornecedores + OC + alertas · Relatórios |
| V3 — PDV | planejado | — |
| V4 — Integrações | planejado | WhatsApp API, Mercado Livre, pagamentos |

---

## Missões ativas (fonte: Rayzen)

| Versão | Missão ID | Título |
|---|---|---|
| V1 | `b66a0db6` | Dashboard métricas de receita (fechar V1) |
| V2 | `16d3b762` | CRM: valor estimado + funil de conversão |
| V2 | `73ea2d38` | Estoque: Fornecedores + Ordens de compra + Alertas |
| V2 | `ff692c05` | Relatórios (receita, produtos, clientes, giro) |

---

## Critérios de sucesso

- [ ] Feature implementada, testada e em produção (Vercel)
- [ ] Multi-tenant preservado (sem vazamento entre tenants)
- [ ] RBAC respeitado (6 roles)
- [ ] ROADMAP.md do RCP atualizado após entrega
- [ ] Missão marcada como done no Rayzen

---

## Limites

```
✗ Não misturar dados de tenants distintos
✗ Não alterar schema sem migration versionada
✗ Não fazer deploy manual — usar Vercel CI
✗ Não criar role fora dos 6 definidos sem ADR
```

---

## Referências

- ROADMAP.md: fonte de verdade do estado do RCP (no repo do RCP)
- Work panel: selecionar "Rayzen Commerce Platform" → /mission
