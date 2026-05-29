# 006 — Skill Engine

## Visão Geral

O Skill Engine é o catálogo e executor de skills — capacidades concretas e determinísticas que o sistema pode executar sem precisar chamar um modelo de IA. Skills são preferidas sobre IA sempre que possível: são mais rápidas, mais baratas e mais previsíveis.

Na V2, skills são registradas dinamicamente, têm metadata rico (descrição, inputs, outputs, custo, categoria, risco) e podem ser compostas em sequências.

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `apps/agent/src/executor.ts` | Switch-case estático de 25 ações — é o "executor de skills" atual |
| `apps/agent/src/security/whitelist.ts` | Whitelist de ações (Set) + separação DESKTOP/SERVER |
| `apps/agent/src/actions/` | 25 implementações de ações (open-app, git, docker, etc.) |
| `apps/api/src/modules/execution/` | Dispatcher HTTP → Bull Queue → Agent poll |
| `apps/api/src/modules/content-engine/` | Skills de geração de conteúdo |
| `apps/api/src/modules/document-processing/` | Skills de PDF e DOCX |

**Problema na V1:** Skills hardcoded em switch-case, sem registry, sem metadata, sem composição. Adicionar skill exige editar 3 arquivos (`whitelist.ts`, `executor.ts`, nova ação).

---

## Gaps

- Registry dinâmico: `Map<skillId, SkillDefinition>` carregado em runtime
- Metadata por skill: nome, descrição, categoria, inputs esperados, outputs, custo estimado, nível de risco, role requerida
- Composição: skill pode chamar outras skills em sequência
- Plugin pattern: skills externas carregáveis via módulo Node
- Skill versioning: múltiplas versões de uma skill ativas simultaneamente
- Custo tracking integrado com `009-cost-controller`

---

## Interface / Endpoints

```
POST /v2/skills/run              # Executa uma skill
GET  /v2/skills                  # Lista skills disponíveis
GET  /v2/skills/:id              # Detalhes de uma skill
GET  /v2/skills/categories       # Categorias de skills
POST /v2/skills/dry-run          # Simula execução sem efeito
```

**Payload execução:**
```typescript
interface SkillRunRequest {
  skillId:   string
  input:     Record<string, unknown>
  projectId?: string
  missionId?: string
  stepId?:   string              // step da missão que disparou
  dryRun?:   boolean
}

interface SkillRunResult {
  skillId:    string
  success:    boolean
  output:     Record<string, unknown>
  durationMs: number
  cost?:      number             // custo em USD se aplicável
  logs:       string[]
}
```

---

## Modelo de Dados

```typescript
type SkillCategory =
  | 'filesystem'  | 'git'       | 'docker'  | 'terminal'
  | 'browser'     | 'editor'    | 'email'   | 'calendar'
  | 'ai'          | 'document'  | 'content' | 'qa'
  | 'data'        | 'system'    | 'network'

type SkillRisk = 'none' | 'low' | 'medium' | 'high'
type SkillRole = 'desktop' | 'server' | 'both'

interface SkillDefinition {
  id:          string
  name:        string
  description: string
  category:    SkillCategory
  risk:        SkillRisk
  role:        SkillRole
  version:     string
  inputSchema: Record<string, unknown>   // JSON Schema
  outputSchema: Record<string, unknown>  // JSON Schema
  estimatedCostUsd?: number
  estimatedMs?:      number
  composedOf?:       string[]            // sub-skills
  handler:     (input: unknown) => Promise<unknown>
}
```

---

## Dependências

- **002 — Router**: Skill Engine é acionado quando routing retorna `type: 'skill'`
- **001 — Mission Engine**: steps de missão do tipo `executor: 'skill'` passam pelo Skill Engine
- **009 — Cost Controller**: registra custo de skills pagas
- **014 — Human Approval Gates**: skills com `risk: 'high'` exigem aprovação
- **010 — Observability**: log de cada execução

---

## Fase de Implementação

**Fase 2** — após Mission Engine e Router.

Ordem:
1. `SkillRegistry` — Map com definições, carregamento das 25 ações V1
2. `SkillEngineService.run()` — substitui switch-case do executor
3. Migration das ações V1 para o formato `SkillDefinition`
4. Endpoint `/v2/skills`
5. Composição de skills (Fase 3)
6. Plugin loader externo (Fase 5)
