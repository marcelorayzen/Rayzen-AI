# 007 — Documentation Engine

## Visão Geral

O Documentation Engine gera, versiona e sincroniza toda a documentação do projeto automaticamente. Na V2, documentação é um **subproduto nativo** de cada missão — não uma ação manual disparada pelo usuário.

Cada missão concluída produz documentação específica de acordo com seu tipo e fase.

---

## Mapeamento V1

| Módulo V1 | Sobreposição |
|---|---|
| `apps/api/src/modules/wiki/` | Páginas wiki versionadas, compilação via LLM, merge, busca |
| `apps/api/src/modules/documentation/` | Gera 5 tipos de doc (project_state, decisions_log, next_actions, work_journal, data_map) |
| `apps/api/src/modules/project-state/` → `ProjectDocument` | Armazena docs gerados com histórico e diff |
| `apps/api/src/modules/wiki/wiki-compilation.service.ts` | Compila conteúdo bruto em wiki com LLM |

**O que já funciona bem na V1:**
- Wiki com versioning, slug, tags, `related_keywords`
- Docs auto-gerados após checkpoint
- Histórico de versões com diff

**Problema na V1:** Documentação desacoplada da execução — não há linkagem clara entre "missão X → docs gerados". Sync externo (Notion/Obsidian) é manual.

---

## Gaps

- Mapeamento explícito: `MissionType → DocTypes gerados automaticamente`
- Validação de docs: schema de completude antes de marcar missão como done
- Sync automático com Notion (já existe módulo `notion/`) e Obsidian (já existe `obsidian/`)
- Trigger de geração linkado ao lifecycle da missão (não só ao checkpoint)
- Doc de arquitetura gerado automaticamente ao concluir missão de tipo `architecture`

---

## Interface / Endpoints

```
POST /v2/docs/generate/:missionId    # Gera docs para missão concluída
GET  /v2/docs/:projectId             # Lista todos os docs do projeto
GET  /v2/docs/:projectId/:type       # Doc específico
POST /v2/docs/sync/:projectId        # Sincroniza com Notion/Obsidian
GET  /v2/wiki/:slug                  # Wiki page (mantém compatibilidade V1)
PUT  /v2/wiki/:slug                  # Atualiza wiki
```

---

## Modelo de Dados

```typescript
type DocType =
  | 'project_state'    // estado atual do projeto
  | 'decisions_log'    // registro de decisões
  | 'next_actions'     // próximas ações
  | 'work_journal'     // diário de trabalho
  | 'architecture'     // doc de arquitetura (novo no V2)
  | 'mission_report'   // relatório de missão concluída (novo no V2)
  | 'api_reference'    // referência de API gerada automaticamente (novo)
  | 'data_map'         // mapa de dados

// Mapeamento: tipo de missão → docs gerados
const MISSION_DOC_MAP: Record<MissionType, DocType[]> = {
  'implementation': ['work_journal', 'decisions_log', 'mission_report'],
  'architecture':   ['architecture', 'decisions_log', 'mission_report'],
  'debugging':      ['work_journal', 'mission_report'],
  'review':         ['decisions_log', 'next_actions'],
  'research':       ['wiki', 'decisions_log'],
}

interface DocGenerationJob {
  id:        string
  projectId: string
  missionId?: string
  type:      DocType
  status:    'pending' | 'running' | 'done' | 'failed'
  output?:   string
  createdAt: Date
}
```

---

## Dependências

- **001 — Mission Engine**: trigger de geração no evento `mission:completed`
- **004 — Memory Engine**: docs gerados são indexados automaticamente na memória
- **003 — AI Router**: usa tier 2-3 para compilação de docs
- **010 — Observability**: log de geração com duração e custo

---

## Fase de Implementação

**Fase 3** — após Mission Engine estabilizado.

Ordem:
1. `DocumentationEngineService` — refatora `documentation.service.ts` existente
2. Listener de evento `mission:completed` → dispara geração
3. Mapeamento `MissionType → DocTypes`
4. Sync automático Notion (reusa `notion/` existente)
5. Doc de arquitetura e `mission_report` (tipos novos)
