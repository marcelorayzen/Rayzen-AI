import { execSync } from 'child_process'
import { decidir, type Decisao } from '../exec/decidir'
import { executarPrograma } from '../exec/executar-programa'
import { removerWorktree } from '../exec/workspace-isolado'

/**
 * Fase 6 do plano de execução tipada — este arquivo deixou de DECIDIR e passou a só EXECUTAR
 * o que `exec/decidir.ts` já decidiu. Antes, `runCommand`/`runCapability` misturavam cinco
 * checagens de autorização (whitelist, role-policy, path-guard/workdir, `BLOCKED_PATTERNS`/
 * `ALLOW_RULES`, gate de aprovação) com a execução propriamente dita, cada checagem decidindo
 * sozinha sem ver o conjunto. `decidir()` é agora o único ponto de decisão; aqui só sobra
 * "dado o veredito, o que eu mostro ou rodo" — nenhuma lógica de autorização nova deveria
 * voltar a aparecer neste arquivo.
 *
 * O contrato EXTERNO (`runCommand`, `RunCommandResult`, toda mensagem de erro e todo texto de
 * `output`) foi preservado byte a byte em relação ao que existia antes desta fase — confirmado
 * pela suíte de testes inteira passando sem alterar uma única asserção de comportamento
 * (`security/__tests__/run-command-safety.spec.ts`,
 * `actions/__tests__/encadeamento-de-comando.spec.ts`,
 * `actions/__tests__/terminal-fase5-red.spec.ts`,
 * `actions/__tests__/terminal-capability-fase2.spec.ts`,
 * `actions/__tests__/terminal-capability-fase3-workdir.spec.ts`,
 * `exec/__tests__/aprovacao-no-agent.spec.ts`, `__tests__/composicao-de-camadas.spec.ts`).
 */

export interface RunCommandResult {
  command: string
  output:  string
  dryRun:  boolean
  risk:    string
  label:   string
  skipped: boolean
  reason?: string
  /** Item C.3 do plano de execução tipada — quem aprovou, quando uma aprovação foi de fato
   * consumida (`decisao.registroDeAuditoria.aprovadoPor`). `poller.ts` lê este campo do
   * RESULTADO para gravar no audit do servidor — nunca presente em `dryRun`/recusa. */
  aprovadoPor?: string
}

function comandoExibido(decisao: Decisao): string {
  return decisao.execucao.forma === 'capability'
    ? `${decisao.execucao.programa} ${decisao.execucao.argv.join(' ')}`
    : decisao.execucao.comando
}

function previewDryRun(decisao: Decisao): RunCommandResult {
  const cmd = comandoExibido(decisao)
  const cwd = decisao.workdir
  const output = decisao.execucao.forma === 'capability'
    ? `[dryRun] Executaria capability "${decisao.execucao.label}": ${cmd}${cwd ? ` em ${cwd}` : ''} (risco: ${decisao.risco})`
    : `[dryRun] Executaria: ${cmd}${cwd ? ` em ${cwd}` : ''} (timeout: ${decisao.execucao.timeoutMs / 1000}s, risco: ${decisao.risco})`
  return { command: cmd, output, dryRun: true, risk: decisao.risco, label: decisao.execucao.label, skipped: false }
}

function bloqueado(decisao: Decisao): RunCommandResult {
  return {
    command: comandoExibido(decisao),
    output: `[BLOQUEADO] Risco ${decisao.risco} — exige aprovação humana criada no servidor. ${decisao.motivo ?? ''}`.trim(),
    dryRun: true, risk: decisao.risco, label: decisao.execucao.label, skipped: true,
    reason: 'high-risk requires human approval',
  }
}

async function executar(decisao: Decisao): Promise<RunCommandResult> {
  const cwd = decisao.workdir

  if (decisao.execucao.forma === 'capability') {
    const { programa, argv, timeoutMs, label } = decisao.execucao
    const r = await executarPrograma('executavel', programa, argv, {
      cwd: cwd ?? process.cwd(), env: decisao.envPermitido, timeoutMs,
    })
    const saida = (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim()
    if (r.code !== 0 && !saida) {
      throw new Error(`capability "${label}" falhou (exit ${r.code}) sem saída.`)
    }
    return {
      command: comandoExibido(decisao), output: saida.slice(0, 4000), dryRun: false, risk: decisao.risco, label, skipped: false,
      aprovadoPor: decisao.registroDeAuditoria.aprovadoPor,
    }
  }

  const { comando, timeoutMs, label } = decisao.execucao
  let output: string
  try {
    try {
      output = execSync(comando, {
        encoding: 'utf-8', cwd, timeout: timeoutMs, env: decisao.envPermitido,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string }
      output = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim()
      if (!output) throw new Error(`Falha: ${e.message ?? String(err)}`)
    }
  } finally {
    // Item A.3 da varredura pós-plano (12/09) — libera o workspace isolado sempre, sucesso ou
    // falha, do mesmo jeito que `supervised-session.ts`'s `finalizar()` já faz para a sessão
    // supervisionada. `removerWorktree()` nunca perde commit (só libera o checkout); o branch
    // só é apagado quando o próprio git confirma que não há trabalho não-alcançável.
    if (decisao.workspaceIsolado) {
      const { base, worktree } = decisao.workspaceIsolado
      await removerWorktree(base, worktree)
    }
  }
  return {
    command: comando, output: output.slice(0, 4000), dryRun: false, risk: decisao.risco, label, skipped: false,
    aprovadoPor: decisao.registroDeAuditoria.aprovadoPor,
  }
}

export async function runCommand(payload: {
  command?:    string
  capability?: string
  params?:     Record<string, unknown>
  path?:       string
  /** Fase 3 — preferido a `path` para o despacho por capability. Ignorado no `{command}` de texto livre por ora. */
  projectId?:  string
  dryRun?:     boolean
  force?:      boolean
}): Promise<RunCommandResult> {
  // `command === undefined` é "não mandou nenhum dos dois". `command === ''` é diferente — é um
  // comando de verdade, só que vazio, e precisa continuar caindo no fluxo antigo (que já recusa
  // com "não reconhecido"): esse contrato já tinha teste antes da Fase 2.
  if (payload.capability === undefined && payload.command === undefined) {
    throw new Error('Informe "command" (texto livre) ou "capability" (Fase 2, tipada).')
  }

  const role: 'desktop' | 'server' = process.env.AGENT_ROLE === 'server' ? 'server' : 'desktop'
  const decisao = await decidir({
    role,
    capability: payload.capability,
    params:     payload.params,
    command:    payload.command,
    path:       payload.path,
    projectId:  payload.projectId,
    dryRun:     payload.dryRun,
  })

  if (payload.dryRun) return previewDryRun(decisao)
  if (!decisao.permitido) return bloqueado(decisao)
  return executar(decisao)
}
