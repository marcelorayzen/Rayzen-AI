# 012 — Project Memory

## Visão Geral

Project Memory é a especialização do Memory Engine para o nível de projeto — memória estruturada por projeto com classes explícitas, consolidação automática e descarte inteligente. Se o Memory Engine é a infraestrutura, o Project Memory é a camada de negócio sobre ela.

Cada projeto tem sua própria "mente": o que aprendeu, o que decidiu, o que tentou e falhou.

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `Document` model com `projectId` | Chunks indexados por projeto já existem |
| `WikiPage` + `WikiSourceReference` | Wiki rastreia origem dos chunks via `Document.projectId` |
| `Event` com `intent` (decision/idea/problem) | Eventos classificados por intent — proto-memória de decisões |
| `Brain` module | Busca e síntese por projeto |

**Problema na V1:** Memória flat — todos os chunks têm o mesmo peso, sem hierarquia, sem ciclo de vida por projeto, sem descarte automático de informação desatualizada.

---

## Gaps

- **Memória de decisões**: toda `Event` com `intent: 'decision'` é automaticamente promovida para `memoryClass: 'consolidated'`
- **Memória de falhas**: falhas de missão são indexadas como lessons learned
- **Descarte automático**: chunks em `working` sem acesso por 30 dias → `archive`; chunks em `archive` por 90 dias → deletados (com resumo mantido)
- **Cross-project search**: busca com permissão explícita em projetos relacionados
- **Memory health**: score de qualidade da memória do projeto (cobertura, atualidade, redundância)

---

## Interface / Endpoints

```
GET  /v2/projects/:id/memory              # Resumo da memória do projeto
GET  /v2/projects/:id/memory/decisions    # Decisões registradas
GET  /v2/projects/:id/memory/failures     # Falhas e lessons learned
POST /v2/projects/:id/memory/search       # Busca na memória do projeto
POST /v2/projects/:id/memory/consolidate  # Dispara consolidação
GET  /v2/projects/:id/memory/health       # Score de saúde da memória
```

---

## Modelo de Dados

```typescript
// Tipos especiais de memória por projeto
type ProjectMemoryType =
  | 'decision'      // decisão técnica ou de produto
  | 'lesson'        // lesson learned de falha
  | 'pattern'       // padrão de código ou processo recorrente
  | 'constraint'    // restrição que não pode ser ignorada
  | 'assumption'    // premissa assumida (pode se tornar inválida)

interface ProjectMemoryEntry extends MemoryEntry {
  memoryType:    ProjectMemoryType
  missionId?:   string          // missão que gerou esta memória
  confidence:   number          // 0-1 — quão confiável é esta memória
  validUntil?:  Date            // data de expiração explícita
  relatedIds:   string[]        // outras memórias relacionadas
}

interface ProjectMemoryHealth {
  projectId:     string
  totalChunks:   number
  byClass:       Record<MemoryClass, number>
  byType:        Record<ProjectMemoryType, number>
  avgAge:        number          // dias médios dos chunks
  staleness:     number          // % chunks não acessados em 30 dias
  score:         number          // 0-100
}
```

---

## Dependências

- **004 — Memory Engine**: Project Memory é construída sobre o Memory Engine
- **001 — Mission Engine**: missões concluídas alimentam a memória do projeto
- **005 — Context Engine**: Project Memory é consultada ao construir contexto
- **007 — Documentation Engine**: docs gerados são indexados como memória consolidada

---

## Fase de Implementação

**Fase 2** — junto com Context Engine.

Ordem:
1. Adicionar campos `memoryType`, `confidence`, `validUntil` ao model `Document`
2. `ProjectMemoryService` com lógica de promoção automática de decisões
3. Indexação automática de falhas de missão como `lesson`
4. Endpoint `/v2/projects/:id/memory`
5. Cross-project search (Fase 4)
6. Memory health score (Fase 4)
