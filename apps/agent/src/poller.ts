import axios from 'axios'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { hostname } from 'node:os'
import { AgentRole, Task } from '@rayzen/types'
import { executeTask } from './executor'
import { recursoDaTarefa, comRecurso } from './exec/recurso'

const AGENT_ROLE: AgentRole = process.env.AGENT_ROLE === 'server' ? 'server' : 'desktop'
const HOSTNAME = hostname()

/**
 * De quanto em quanto tempo dizer ao servidor "ainda estou nesta tarefa" (A05). Folga de 3×
 * sobre o TTL da posse (60s) do lado da API: uma renovação perdida por rede instável não faz a
 * tarefa ser dada como órfã.
 */
const RENOVAR_POSSE_A_CADA_MS = 20_000

/**
 * Teto de tarefas em voo neste processo. Não existia nenhum: `index.ts` faz
 * `setInterval(poll, 3000)` e `poll()` não espera a volta anterior, então durante uma sessão
 * supervisionada de horas o agent reivindicava mais uma tarefa **a cada 3 segundos**.
 *
 * O teto não é escalonador — é o que impede a fila de crescer sem fim dentro de um processo só.
 * A exclusão de verdade é por recurso (`exec/recurso.ts`); este número existe para que o
 * ACÚMULO tenha um limite, e é generoso de propósito: apertar demais faria tarefa barata esperar
 * sessão longa sem nenhum motivo físico.
 */
const LIMITE_DE_TAREFAS_SIMULTANEAS = Number(process.env.AGENT_MAX_TAREFAS_SIMULTANEAS ?? 4)

let emVoo = 0

const api = axios.create({
  baseURL: process.env.AGENT_API_URL,
  headers: { Authorization: `Bearer ${process.env.AGENT_TOKEN}` },
  timeout: 10_000,
})

export async function poll(): Promise<void> {
  // Nem reivindica no teto. Reivindicar para depois segurar seria pior que não reivindicar:
  // a tarefa sairia da fila do servidor e ficaria parada dentro de um processo, invisível a
  // quem consulta o estado dela.
  if (emVoo >= LIMITE_DE_TAREFAS_SIMULTANEAS) return

  try {
    // Claim atômico: garante que dois agents não executam a mesma tarefa
    const { data: task } = await api.post<Task | null>('/tasks/claim', { role: AGENT_ROLE, hostname: HOSTNAME })
    if (task) {
      emVoo++
      try {
        await processTask(task)
      } finally {
        emVoo--
      }
    }
  } catch (err) {
    // Falha silenciosa — PC pode estar offline temporariamente
    if (process.env.NODE_ENV === 'development') {
      console.error('[poll] erro:', (err as Error).message)
    }
  }
}

async function processTask(task: Task): Promise<void> {
  console.log(`[agent] executando: ${task.module}/${task.action} (${task.id})`)

  const startedAt = Date.now()
  const payload = task.payload as Record<string, unknown>
  const workspace = typeof payload.path === 'string' ? resolve(payload.path) : process.cwd()

  // Campos de audit comuns a todas as notificações
  const auditBase = {
    module: task.module,
    action: task.action,
    hostname: HOSTNAME,
    targetRole: AGENT_ROLE,
    workspace,
  }

  // Extrai command/risk/dryRun para ações de terminal
  const command = typeof payload.command === 'string' ? payload.command : undefined
  const risk = typeof payload.risk === 'string' ? payload.risk : undefined
  const dryRun = payload.dryRun === true

  // A05: enquanto esta tarefa executa, renova a posse. É o que permite ao servidor distinguir
  // "o executor morreu" de "a tarefa é longa" — antes o lock era um teto fixo de 30s que não
  // servia nem para a sessão supervisionada (horas) nem como sinal de vida. Parar de renovar é
  // a evidência; o relógio sozinho nunca foi.
  //
  // `unref()` para este timer nunca segurar o processo vivo por conta própria.
  const renovacao = setInterval(() => {
    api.post(`/tasks/${task.id}/heartbeat`, { hostname: HOSTNAME, role: AGENT_ROLE }).catch(() => null)
  }, RENOVAR_POSSE_A_CADA_MS)
  renovacao.unref?.()

  try {
    // A espera pelo recurso acontece DEPOIS do heartbeat começar, e a ordem é o ponto: uma
    // tarefa parada na fila do diretório continua sendo uma tarefa viva. Esperar antes de
    // renovar a posse a faria ser declarada órfã em 60s por estar se comportando direito.
    const recurso = recursoDaTarefa(task.action, payload)
    if (recurso) console.log(`[agent] ${task.id} aguarda recurso ${recurso}`)
    const result = await comRecurso(recurso, () => executeTask(task))
    const enrichedResult = await maybeUploadEvidence(task, result)
    const durationMs = Date.now() - startedAt

    // Item C.3 do plano de execução tipada — `aprovadoPor` só existe no RESULTADO da
    // execução (`RunCommandResult`, vindo de `decidir()`), nunca no payload de entrada: a
    // identidade de quem aprovou só é conhecida depois que o servidor de aprovações a deu.
    const approvedBy = typeof (enrichedResult as { aprovadoPor?: unknown })?.aprovadoPor === 'string'
      ? (enrichedResult as { aprovadoPor?: string }).aprovadoPor
      : undefined

    // A04 da auditoria de 13/09 — falha de DOMÍNIO não é sucesso.
    //
    // Até aqui, `status: 'done'` era incondicional: só exceção lançada virava `failed`. Uma
    // ação que devolve `{ ok: false, error }` — o caso normal de quem trata o próprio erro em
    // vez de lançar — era gravada como concluída, e o evento logo abaixo publicava "Task
    // concluída" no contexto futuro. O P3 reproduziu exatamente isso.
    //
    // A comparação é ESTRITA (`=== false`), não `!ok`: a maioria das ações não devolve `ok`
    // nenhum, e tratar ausência como falha mudaria o comportamento de todas elas de graça.
    // Só se corrige a ação que DECLARA fracasso e era ignorada.
    const declarouFalha =
      typeof enrichedResult === 'object' &&
      enrichedResult !== null &&
      (enrichedResult as { ok?: unknown }).ok === false

    if (declarouFalha) {
      const declarado = (enrichedResult as { error?: unknown }).error
      const error = typeof declarado === 'string' && declarado.trim().length > 0
        ? declarado
        : `${task.module}/${task.action} devolveu ok:false sem mensagem de erro`

      await api.patch(`/tasks/${task.id}`, {
        status: 'failed',
        error,
        result: enrichedResult,
        durationMs,
        command,
        risk,
        dryRun,
        approvedBy,
        ...auditBase,
      })
      console.error(`[agent] falha de domínio: ${task.id} — ${error}`)
      return
    }

    await api.patch(`/tasks/${task.id}`, {
      status: 'done',
      result: enrichedResult,
      durationMs,
      command,
      risk,
      dryRun,
      approvedBy,
      ...auditBase,
    })

    // Publica resultado no contexto futuro via Event — aparece em recent_events no próximo prompt
    const taskProjectId = typeof payload.projectId === 'string' ? payload.projectId : undefined
    if (taskProjectId) {
      const summary = JSON.stringify(enrichedResult).slice(0, 200)
      api.post('/events/cli', {
        projectId: taskProjectId,
        source:    'agent-task-result',
        type:      'note',
        intent:    'reference',
        content:   `Task ${task.module}/${task.action} concluída (${durationMs}ms): ${summary}`,
        metadata:  { taskId: task.id, module: task.module, action: task.action, durationMs },
      }).catch(() => null)
    }

    console.log(`[agent] concluído: ${task.id} (${durationMs}ms)`)
  } catch (err) {
    const error = (err as Error).message
    const durationMs = Date.now() - startedAt

    await api.patch(`/tasks/${task.id}`, {
      status: 'failed',
      error,
      durationMs,
      command,
      risk,
      dryRun,
      ...auditBase,
    })
    console.error(`[agent] falhou: ${task.id} — ${error}`)
  } finally {
    // Sucesso, falha de domínio ou exceção: a posse termina aqui. Um intervalo sobrevivente
    // continuaria renovando a posse de uma tarefa já encerrada, e a próxima tarefa presa neste
    // mesmo agent jamais seria reconhecida como órfã.
    clearInterval(renovacao)
  }
}

async function maybeUploadEvidence(task: Task, result: unknown): Promise<unknown> {
  if (task.module !== 'jarvis' || task.action !== 'screenshot') return result

  const payload = task.payload as Record<string, unknown>
  const projectId = typeof payload.projectId === 'string' ? payload.projectId : null
  const screenshot = result as { path?: string; takenAt?: string }
  if (!projectId || !screenshot?.path) return result

  try {
    const bytes = await readFile(screenshot.path)
    const form = new FormData()
    form.set('file', new Blob([bytes], { type: 'image/png' }), basename(screenshot.path))
    form.set('localPath', screenshot.path)
    if (screenshot.takenAt) form.set('takenAt', screenshot.takenAt)
    if (typeof payload.prompt === 'string') form.set('prompt', payload.prompt)
    if (typeof payload.projectName === 'string') form.set('projectName', payload.projectName)
    if (typeof payload.description === 'string') form.set('description', payload.description)
    if (typeof payload.category === 'string') form.set('category', payload.category)

    const response = await fetch(`${process.env.AGENT_API_URL}/evidence/upload/${projectId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.AGENT_TOKEN}` },
      body: form,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const upload = await response.json() as { evidenceId?: string; remotePath?: string; url?: string }
    return { ...screenshot, upload }
  } catch (err) {
    console.error('[agent] falha ao enviar evidência:', (err as Error).message)
    return result
  }
}
