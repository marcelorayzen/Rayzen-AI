# Rayzen AI — PC Agent: Guia Completo

O Agent é dividido em dois papéis:

- `desktop`: roda no PC de trabalho e executa tarefas locais como screenshot, VS Code, clipboard e testes locais;
- `server`: roda na VPS e executa tarefas da stack hospedada, como Docker e restart da API.

O papel `desktop` é separado da API por segurança — a VPS nunca tem acesso direto ao seu PC.

---

## Como funciona

```
Você fala algo → API classifica como "jarvis" → cria tarefa na fila (Redis/BullMQ)
                                                        ↓
                                          PC Agent faz polling a cada 3s
                                                        ↓
                                          Verifica whitelist → executa → retorna resultado
                                                        ↓
                                          API sintetiza resposta em linguagem natural
```

O agent **nunca recebe comandos diretos** — ele só lê tarefas da fila. Se a API cair, o agent para de executar. Se o agent cair, a API continua funcionando normalmente (só o Jarvis fica indisponível).

---

## Ações disponíveis hoje

| Ação | O que faz | Nível de risco |
|---|---|---|
| `jarvis:open_app` | Abre um aplicativo | Baixo |
| `jarvis:list_dir` | Lista arquivos de uma pasta | Baixo |
| `jarvis:get_system_info` | Retorna CPU, RAM, disco, SO | Baixo |
| `jarvis:organize_downloads` | Move arquivos por tipo de extensão | Médio |
| `jarvis:screenshot` | Captura tela, salva por `repoSlug` e envia evidência ao projeto | Médio |
| `jarvis:docker_logs` | Lê logs de container no Agent `server` | Baixo |
| `jarvis:restart_api` | Reinicia a API via Agent `server` | Alto |

---

## Guardrails — camadas de segurança

O agent tem **3 camadas independentes** de proteção. Todas precisam ser aprovadas para uma ação executar.

### Camada 1 — Whitelist de ações (`whitelist.ts`)

```
apps/agent/src/security/whitelist.ts
```

Apenas as ações listadas aqui podem executar. Qualquer `module:action` fora da lista é **rejeitado silenciosamente** antes de qualquer código de negócio rodar.

```typescript
export const ALLOWED_ACTIONS = new Set([
  'jarvis:open_app',
  'jarvis:list_dir',
  'jarvis:organize_downloads',
  'jarvis:create_project_folder',  // na whitelist mas sem handler = erro controlado
  'jarvis:backup_files',           // na whitelist mas sem handler = erro controlado
  'jarvis:get_system_info',
])
```

**Para desativar uma ação:** remova da whitelist. O handler pode continuar existindo — nunca vai ser chamado.
**Para ativar uma nova ação:** adicione na whitelist E implemente o handler (ver seção "Adicionar nova ação").

---

### Camada 2 — Sandbox de diretórios (`list-dir.ts`, `organize-downloads.ts`)

Ações de arquivo só operam dentro de caminhos explicitamente aprovados:

```typescript
// apps/agent/src/actions/list-dir.ts
const SAFE_PATHS = [
  HOME + '\\Downloads',
  HOME + '\\Documents',
  HOME + '\\Desktop',
  HOME + '\\Projects',
]
```

Qualquer tentativa de acessar um caminho fora desses — incluindo path traversal (`../`) — lança erro e a tarefa falha.

**Para adicionar um diretório permitido:**
```typescript
const SAFE_PATHS = [
  HOME + '\\Downloads',
  HOME + '\\Documents',
  HOME + '\\Desktop',
  HOME + '\\Projects',
  HOME + '\\OneDrive',       // ← adicionar aqui
  'D:\\MeusProjetos',        // ← ou caminho absoluto
]
```

**Para restringir mais:** remova pastas da lista. Por exemplo, remover `Desktop` impede o agent de listar arquivos do desktop.

---

### Camada 3 — Lista de apps permitidos (`open-app.ts`)

```typescript
// apps/agent/src/actions/open-app.ts
const ALLOWED_APPS = ['code', 'chrome', 'firefox', 'notion', 'slack']
```

Apenas esses apps podem ser abertos pelo agent. Qualquer outro nome é rejeitado.

**Para adicionar um app:**
```typescript
const ALLOWED_APPS = ['code', 'chrome', 'firefox', 'notion', 'slack', 'spotify', 'discord']
```

O nome deve ser o executável reconhecido pelo sistema (como o `open` npm package o reconhece).

---

## Autonomia — níveis de operação

### Nível 1 — Somente leitura (mais seguro)
Apenas ações que não modificam nada:
```typescript
// whitelist.ts — deixar só estas:
'jarvis:list_dir',
'jarvis:get_system_info',
```

### Nível 2 — Padrão atual
Leitura + organização com dryRun disponível:
```typescript
'jarvis:open_app',
'jarvis:list_dir',
'jarvis:get_system_info',
'jarvis:organize_downloads',
```

### Nível 3 — Autonomia expandida
Inclui criação de pastas, backup de arquivos (implementar handlers):
```typescript
'jarvis:open_app',
'jarvis:list_dir',
'jarvis:get_system_info',
'jarvis:organize_downloads',
'jarvis:create_project_folder',
'jarvis:backup_files',
```

### Nível 4 — Autonomia total (não recomendado sem testes)
Inclui execução de scripts, manipulação de processos, etc.
Requer implementação cuidadosa com dryRun obrigatório.

---

## dryRun — executar sem confirmar

Ações de risco médio/alto devem sempre suportar `dryRun: true`, que simula a execução e retorna o que *seria* feito sem fazer nada de verdade.

Exemplo com `organize_downloads`:
```
Você: organize meus downloads
Agent (dryRun): "Moveria 12 arquivos: 3 PDFs → /PDFs, 5 imagens → /Imagens..."
Você: confirme
Agent (execução real): move os arquivos
```

Hoje o `dryRun` na `organize_downloads` é sempre `true` por padrão (definido no `orchestrator.service.ts`). Para permitir execução real, mude:

```typescript
// apps/api/src/modules/orchestrator/orchestrator.service.ts
// função buildJarvisPayload()
return { path, dryRun: action === 'organize_downloads' ? false : undefined }
//                                                        ↑ mude para false
```

---

## Adicionar uma nova ação

Exemplo completo: adicionar `jarvis:kill_process` (fechar um processo pelo nome).

**Passo 1 — Whitelist**
```typescript
// apps/agent/src/security/whitelist.ts
export const ALLOWED_ACTIONS = new Set([
  // ...existentes...
  'jarvis:kill_process',
])
```

**Passo 2 — Implementar a ação**
```typescript
// apps/agent/src/actions/kill-process.ts
import { execSync } from 'child_process'

const ALLOWED_PROCESSES = ['chrome', 'code', 'notepad']  // guardrail próprio

export async function killProcess(payload: { name: string; dryRun?: boolean }) {
  const name = payload.name.toLowerCase()
  if (!ALLOWED_PROCESSES.includes(name)) {
    throw new Error(`Processo não permitido: ${name}`)
  }
  if (payload.dryRun) {
    return { dryRun: true, wouldKill: name }
  }
  execSync(`taskkill /F /IM ${name}.exe`, { encoding: 'utf-8' })
  return { killed: name }
}
```

**Passo 3 — Registrar no executor**
```typescript
// apps/agent/src/executor.ts
import { killProcess } from './actions/kill-process'

// Dentro do switch:
case 'jarvis:kill_process':
  return killProcess(task.payload as { name: string; dryRun?: boolean })
```

**Passo 4 — Registrar no orquestrador**
```typescript
// apps/api/src/modules/orchestrator/orchestrator.service.ts
// função buildJarvisPayload() — adicionar case:
if (action === 'kill_process') {
  const lower = prompt.toLowerCase()
  const name = ALLOWED_PROCESSES.find((p) => lower.includes(p)) ?? 'chrome'
  return { name, dryRun: true }
}
```

**Passo 5 — Atualizar o classifier**
```typescript
// apps/api/src/modules/orchestrator/orchestrator.service.ts
// No system prompt do classify():
`Ações do jarvis disponíveis: open_app, list_dir, organize_downloads, get_system_info, kill_process`
```

---

## Remover uma ação existente

Para desabilitar `organize_downloads` completamente:

1. Remova `'jarvis:organize_downloads'` da `whitelist.ts`
2. (Opcional) Remova o case do `executor.ts`
3. (Opcional) Remova do classifier no `orchestrator.service.ts`

O handler em `organize-downloads.ts` pode ficar — sem a whitelist, nunca é chamado.

---

## Configuração de polling

```bash
# apps/agent/.env
AGENT_POLL_INTERVAL_MS=3000    # intervalo entre polls (padrão: 3s)
AGENT_API_URL=http://localhost:3101
AGENT_TOKEN=<token>
```

**Para reduzir latência** (agent mais responsivo): `AGENT_POLL_INTERVAL_MS=1000`
**Para reduzir carga** (máquina mais lenta): `AGENT_POLL_INTERVAL_MS=10000`

---

## Estrutura de arquivos

```
apps/agent/src/
├── index.ts                    # entrada — inicia o loop de polling
├── poller.ts                   # busca tarefas pendentes na API e chama executor
├── executor.ts                 # verifica whitelist e roteia para a ação correta
├── security/
│   └── whitelist.ts            # ← GUARDRAIL PRINCIPAL — editar aqui para controlar acesso
└── actions/
    ├── open-app.ts             # abre aplicativos (lista própria de apps permitidos)
    ├── list-dir.ts             # lista diretórios (sandbox de caminhos)
    ├── organize-downloads.ts   # organiza arquivos por extensão (suporta dryRun)
    └── get-system-info.ts      # retorna info de CPU, RAM, disco, SO
```

---

## Checklist de segurança antes de adicionar uma ação

- [ ] A ação tem guardrail próprio (lista de valores permitidos ou validação de input)?
- [ ] Se manipula arquivos: verifica se o caminho está dentro do sandbox?
- [ ] Se é destrutiva (deletar, mover, fechar): tem suporte a `dryRun`?
- [ ] Está na whitelist?
- [ ] Tem handler no `executor.ts`?
- [ ] Foi testada manualmente antes de ser usada em produção?
