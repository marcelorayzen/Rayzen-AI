# 010 — Resource Manager

## Visão Geral

O Resource Manager é o guardião de recursos do sistema. Inspirado no conceito de AgentRM (Resource Manager para agentes autônomos), ele controla o consumo de tokens, contexto, agentes ativos, ferramentas e memória — evitando os problemas mais comuns em sistemas agentes longos.

É um componente **transversal**: não faz parte do pipeline de execução de uma missão específica, mas monitora e limita o que todos os outros componentes podem consumir.

---

## Problemas que resolve

**Context Explosion:**  
Missões longas acumulam contexto sem controle. Um agente que começa com 2k tokens pode chegar a 100k tokens desnecessariamente, aumentando custo e degradando qualidade.

**Zombie Agents:**  
Especialistas instanciados que nunca foram destruídos continuam consumindo recursos. Sem gerenciamento de lifecycle, o sistema acumula instâncias ociosas.

**Loop Infinito:**  
Um step que falha e retenta indefinidamente. Sem limite de tentativas e tempo máximo, uma missão pode rodar para sempre.

**Memory Bloat:**  
Memória que cresce sem controle — chunks redundantes, documentos obsoletos, embeddings de conteúdo que não é mais relevante.

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `costs/` (se existir) | Logging de tokens — sem enforcement |
| `AgentAuditLog` | Registra execuções do agente — sem limite |
| `supervised-session` → `maxIterations: 20` | Único limite de iteração existente na V1 |

**Status V1:** Não existe Resource Manager. Limites são hardcoded e pontuais, sem visão centralizada.

---

## Gaps

- Orçamento de tokens por missão e por step (não só por projeto)
- Limite de agentes ativos simultâneos
- TTL de agentes: especialista não destruído após N minutos → destruição automática
- Context window budget: antes de cada chamada de IA, verifica se contexto cabe no budget
- Detecção de loop: step que falha >N vezes no mesmo estado → escalação para Human Approval Gate
- Memory quota por projeto: limite de chunks, triggera compactação/consolidação automática

---

## Interface / Endpoints

```
GET  /v2/resources/status              # Snapshot atual de todos os recursos
GET  /v2/resources/agents              # Agentes ativos e consumo por agente
POST /v2/resources/agents/:id/destroy  # Destroi agente manualmente
GET  /v2/resources/context/:missionId  # Uso de contexto da missão atual
GET  /v2/resources/limits              # Limites configurados
PATCH /v2/resources/limits             # Atualiza limites
```

---

## Modelo de Dados

```typescript
interface ResourceLimits {
  projectId:        string
  maxTokensPerStep:  number       // default: 8000
  maxTokensPerMission: number     // default: 100000
  maxActiveAgents:   number       // default: 3
  agentTtlMinutes:   number       // default: 30
  maxStepRetries:    number       // default: 3
  maxMissionDurationMinutes: number // default: 120
  maxMemoryChunks:   number       // default: 10000
}

interface ResourceSnapshot {
  timestamp:      Date
  activeAgents:   AgentResourceInfo[]
  missionContexts: MissionContextInfo[]
  totalTokensUsed: number
  memoryChunks:   number
}

interface AgentResourceInfo {
  agentId:     string
  type:        SpecialistType
  missionId:   string
  tokensUsed:  number
  startedAt:   Date
  idleSince?:  Date
  status:      'active' | 'idle' | 'zombie'
}

interface MissionContextInfo {
  missionId:   string
  contextTokens: number
  budget:      number
  percentUsed: number
}
```

**Regras de enforcement:**
```typescript
// Antes de cada chamada de IA — Resource Manager verifica:
if (contextTokens > limits.maxTokensPerStep) → compactar contexto
if (missionTokens > limits.maxTokensPerMission) → pausar missão, notificar
if (activeAgents >= limits.maxActiveAgents) → enfileirar próximo especialista
if (agent.idleSince > limits.agentTtlMinutes) → destruir automaticamente
if (step.retries >= limits.maxStepRetries) → abrir Human Approval Gate
```

---

## Dependências

- **001 — Mission Engine**: verifica limites antes de iniciar cada step
- **003 — AI Router**: verifica budget de tokens antes de cada chamada
- **011 — Specialists**: controla lifecycle de especialistas
- **009 — Cost Controller**: recebe dados de consumo para registro
- **014 — Human Approval Gates**: escalação quando limite crítico é atingido
- **013 — Observability**: expõe métricas de recursos via Prometheus

---

## Fase de Implementação

**Fase 4** — após os componentes principais estarem funcionando. O Resource Manager é mais fácil de implementar quando já existe tráfego real para monitorar.

Ordem:
1. `ResourceLimits` model + defaults por projeto
2. Middleware no AI Router: verifica budget antes de cada chamada
3. TTL job para agentes zumbis (BullMQ, verifica a cada 5 minutos)
4. Detecção de loop no Mission Engine (contagem de retries por step)
5. Dashboard `/v2/resources/status`
6. Compactação automática de contexto (integração com Context Engine)
