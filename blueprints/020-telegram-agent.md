# 016 — Telegram Agent (Mobile Interface)

## Visão Geral

O Telegram Agent transforma o bot atual (canal passivo de notificações de sessões supervisionadas) em uma **interface mobile completa** do Rayzen. Do celular, você consulta estado de projetos, dispara checkpoints, recebe notificações proativas e interage com o Orchestrator exatamente como no chat web.

Caso de uso principal: você está na rua, abre o Telegram e pergunta "qual o estado atual do VB Ferragens?" — o bot consulta o Orchestrator e responde com o mesmo conteúdo que apareceria no painel web.

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `apps/api/src/modules/telegram/telegram.service.ts` | Polling, send, sendPhoto — infraestrutura já existe |
| `apps/api/src/modules/agent-session/agent-session.service.ts` | Usa Telegram para notificações de sessões supervisionadas |
| `apps/api/src/modules/orchestrator/` | `POST /orchestrate` aceita `sessionId` + `projectId` — pronto para receber mensagens do Telegram |
| `ConversationMessage` model | Guarda histórico por `sessionId` — funciona para sessões Telegram sem mudança |

**Problema na V1:** mensagens Telegram fora de sessão supervisionada recebem `"Nenhuma sessão ativa"` e são descartadas. O Orchestrator nunca é chamado.

---

## Gaps

- `TelegramSession` model: persiste `sessionId` e `projectId` ativo por `chatId`
- Routing de mensagens normais → Orchestrator (hoje só vai para `replyHandler`)
- Seleção de projeto com contexto persistente por chat
- Comandos slash estruturados com inline keyboards
- Notificações proativas emitidas pelos módulos existentes
- Webhook opcional (troca polling 1s por push do Telegram)

---

## Como o bot sabe qual projeto usar

```
1ª mensagem ou /projeto → bot lista projetos com botões inline
Usuário clica no botão  → projectId salvo em TelegramSession
Mensagens seguintes     → usam projectId da TelegramSession
/projeto novamente      → troca de projeto
Sem seleção             → usa MCP_PROJECT_ID (padrão do ambiente)
```

A `TelegramSession` é indexada por `telegramChatId` (seu ID único no Telegram). Funciona em qualquer dispositivo onde você abre o mesmo chat.

---

## Interface / Comandos

### Comandos slash

| Comando | Função | Módulo consultado |
|---|---|---|
| `/status` | Estado atual do projeto ativo | `project-state` |
| `/projeto` | Lista projetos para selecionar (inline keyboard) | `project` |
| `/goal` | Meta ativa, progresso, next best action | `graph` |
| `/eventos [n]` | Últimos N eventos da timeline (padrão: 10) | `event` |
| `/checkpoint` | Dispara checkpoint de sessão | `synthesis` |
| `/docs` | Lista documentos gerados do projeto | `documentation` |
| `/wiki <slug>` | Retorna página da wiki | `wiki` |
| `/ajuda` | Lista de comandos disponíveis | — |

### Chat livre

Qualquer mensagem que não seja um comando vai para o Orchestrator com o `projectId` e `sessionId` da `TelegramSession`. O Rayzen responde como no chat web — incluindo acionamento de brain, jarvis, doc engine, etc.

```
Você: "quais são os próximos passos do VB Ferragens?"
Bot:  [consulta Orchestrator → retorna reply do módulo brain/state]
```

### Notificações proativas (push)

O bot envia mensagens sem você perguntar:

| Trigger | Mensagem |
|---|---|
| Checkpoint concluído | Resumo do checkpoint + próximas ações |
| Blocker detectado pelo ProjectState | "⚠️ Novo blocker: [descrição]" |
| Meta estagnada > 5 dias | "🔔 Meta sem progresso há X dias" |
| Sessão supervisionada com pergunta | "❓ Claude pergunta: [texto]" (já existe) |
| Sessão supervisionada concluída | "✅ Concluída: [resumo]" (já existe) |

---

## Modelo de Dados

```typescript
// Novo model no schema Prisma
model TelegramSession {
  id             String   @id @default(uuid())
  telegramChatId String   @unique         // ID do chat no Telegram
  sessionId      String   @default(uuid()) // sessionId para ConversationMessage
  projectId      String?                   // projeto ativo selecionado
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

```typescript
// TelegramService — novos métodos
interface TelegramContext {
  chatId:    string
  sessionId: string
  projectId: string | null
}

// Fluxo de routing no polling:
// 1. Recebe mensagem
// 2. Verifica se é comando slash → executa handler direto
// 3. Se replyHandler ativo (sessão supervisionada) → submitReply()
// 4. Caso contrário → OrchestratorService.handle(prompt, sessionId, projectId)
// 5. Envia resposta via telegram.send()
```

---

## Arquitetura de implementação

```
TelegramService (polling/webhook)
        ↓
  CommandRouter
  ├── /projeto  → ProjectService.list() → inline keyboard
  ├── /status   → ProjectStateService.get()
  ├── /goal     → GraphService.getGoal()
  ├── /eventos  → EventService.findAll()
  ├── /checkpoint → SynthesisService.checkpoint()
  └── [texto livre] → OrchestratorService.handle()
        ↓
  TelegramSession (projectId + sessionId por chatId)
        ↓
  telegram.send(reply)
```

---

## Dependências

- `apps/api/src/modules/orchestrator/orchestrator.service.ts` — consumido para chat livre
- `apps/api/src/modules/project/project.service.ts` — listagem para seleção
- `apps/api/src/modules/project-state/project-state.service.ts` — comando `/status`
- `apps/api/src/modules/graph/graph.service.ts` — comando `/goal`
- `apps/api/src/modules/event/event.service.ts` — comando `/eventos`
- `apps/api/src/modules/synthesis/synthesis.service.ts` — comando `/checkpoint`
- **016 exclusivo:** `TelegramSession` model + `CommandRouter` interno ao módulo

---

## Arquivos a modificar / criar

| Arquivo | Ação |
|---|---|
| `apps/api/src/modules/telegram/telegram.service.ts` | Adicionar `CommandRouter`, integração com Orchestrator, getter de contexto por chatId |
| `apps/api/src/modules/telegram/telegram.module.ts` | Importar módulos necessários (Orchestrator, Project, etc.) |
| `apps/api/src/modules/agent-session/agent-session.service.ts` | Sem mudança no fluxo supervisionado — apenas garantir que não conflita |
| `apps/api/prisma/schema.prisma` | Adicionar `TelegramSession` |

---

## Webhook vs Polling

**Polling atual:** requisição a cada 1s, mesmo sem mensagens → desperdício.

**Webhook:** Telegram faz POST para `https://rayzen.com.br/telegram/webhook` quando chega mensagem. Mais eficiente, latência menor.

Pré-requisito: endpoint público com HTTPS → **já temos** com `rayzen.com.br` + Caddy.

Migração simples:
```typescript
// Registrar webhook uma vez:
POST https://api.telegram.org/bot{TOKEN}/setWebhook
  { url: "https://rayzen.com.br/telegram/webhook" }

// Novo endpoint no Caddy:
// handle /telegram/* { reverse_proxy api:3001 }

// Novo controller na API:
// POST /telegram/webhook → TelegramService.handleWebhook(body)
```

---

## Fases de implementação

**Fase 1 — Chat + comandos básicos (implementar agora)**
1. `TelegramSession` model (migration Prisma)
2. `CommandRouter` em `telegram.service.ts`
3. Integração Orchestrator para mensagens livres
4. Comandos `/projeto`, `/status`, `/goal`, `/ajuda`

**Fase 2 — Notificações proativas**
5. Hooks nos eventos de checkpoint e blocker
6. Comandos `/eventos`, `/checkpoint`, `/docs`, `/wiki`

**Fase 3 — Webhook + inline keyboards**
7. Migrar polling → webhook
8. Botões inline para seleção de projeto e aprovações (Human Approval Gates)
