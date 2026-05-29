# 022 — Skill Runtime

## Visão Geral

O Skill Runtime é o executor in-process das skills no V2. Skills rodam dentro do processo NestJS da API V2 — sem agente externo para a maioria dos casos. Quando uma skill precisa de acesso ao sistema operacional local (screenshot, git, docker), ela é despachada para o agente desktop/server existente. Tudo o mais roda diretamente no processo da API.

Isso simplifica radicalmente a arquitetura: não há Agent A, B, C, D permanentes. Há um runtime que executa skills, e uma Specialist Factory que cria especialistas on-demand quando necessário.

```
Antes (V1):
  API → Bull Queue → Agent poll → executor.ts (switch-case)

Depois (V2):
  Mission Engine → Skill Runtime (in-process) → resultado
                               ↓ quando precisa de OS local
                         Bull Queue → Agent (existente)
```

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `apps/agent/src/executor.ts` | Switch-case de 25 ações — migra para SkillRegistry no Skill Engine |
| `apps/api/src/modules/execution/` | Dispatcher HTTP→Bull→Agent — mantido apenas para skills de sistema |
| `apps/agent/src/poller.ts` | Continua existindo para skills que precisam do OS local |

---

## Duas categorias de skills

### Tipo A — In-process (rodam no NestJS V2)
Skills que não precisam de acesso ao sistema operacional local:
- Chamadas de IA (via AI Router)
- Geração de documentos, wikis, ADRs
- Análise de código (via texto)
- Busca na memória / knowledge graph
- Operações no banco de dados
- Chamadas a APIs externas (Notion, GitHub, Vercel)

### Tipo B — Agent-dispatched (continuam no agente existente)
Skills que precisam do sistema operacional local:
- Screenshots, clipboard, notificações
- Git local, abrir VS Code, apps
- Docker (server agent)
- Leitura de emails, calendário
- Qualquer ação com `role: 'desktop' | 'server'`

```typescript
// SkillDefinition — campo que decide o runtime
interface SkillDefinition {
  ...
  runtime: 'in-process' | 'agent-desktop' | 'agent-server'
}
```

---

## Interface

```typescript
// Skill Runtime Service
class SkillRuntimeService {
  async execute(skillId: string, input: unknown, context: ExecutionContext): Promise<SkillRunResult> {
    const skill = this.registry.get(skillId)

    if (skill.runtime === 'in-process') {
      return this.runInProcess(skill, input, context)
    }

    return this.dispatchToAgent(skill, input, context)  // via Bull Queue existente
  }
}

interface ExecutionContext {
  missionId:  string
  stepId:     string
  projectId:  string
  traceId:    string
  vaultRefs:  Record<string, string>  // vault:// refs já resolvidos
}
```

---

## Specialist Factory

Cria especialistas (agentes de AI temporários) on-demand para steps complexos, sem mantê-los vivos permanentemente:

```typescript
class SpecialistFactory {
  async create(type: SpecialistType, context: ExecutionContext): Promise<SpecialistInstance> {
    // instancia com system prompt + tools limitados ao tipo
    // executa o step
    // destrói imediatamente após conclusão
  }
}
```

Não há pool de especialistas. Cada instância vive apenas pelo tempo do step que a criou.

---

## Dependências

- **007 — Skill Engine**: fornece o registry de skills com tipo de runtime
- **021 — Vault Engine**: resolve `vault://` refs antes de passar input para o skill
- **010 — Resource Manager**: verifica limites antes de executar
- **010 — Observability**: cada execução gera um span rastreado

---

## Fase de Implementação

**Fase 2** — junto com Skill Engine.

Ordem:
1. `SkillRuntimeService` com dispatch in-process vs. agent
2. Migration das 25 ações V1: classificar cada uma como `in-process` ou `agent-dispatched`
3. `SpecialistFactory` básico (wrap do supervised-session existente)
4. Integração com Vault Engine para resolução de refs antes da execução
