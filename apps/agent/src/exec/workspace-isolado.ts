import { executarPrograma, ambientePadrao } from './executar-programa'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * `git worktree` como unidade de isolamento — extraído de `actions/supervised-session.ts`
 * (onde nasceu, para a sessão supervisionada) para `apps/agent/src/exec/` quando o Item A.3 da
 * varredura pós-plano (12/09) passou a precisar do MESMO mecanismo para `run_command` genérico.
 * Duplicar `criarWorktree`/`removerWorktree` entre os dois chamadores seria repetir o erro que
 * o plano de execução tipada inteiro existe para evitar — duas cópias divergem em silêncio.
 *
 * `instrucoesDeMerge()` (texto de UX específico da sessão supervisionada) continua em
 * `supervised-session.ts` — não é mecânica de git, é apresentação.
 */

export interface Worktree {
  readonly dir: string
  readonly branch: string
}

/**
 * Migrado na Fase 1: `execSync` de string montada (`git worktree add -b ${branch} "${dir}"`)
 * → `executarPrograma('executavel', ...)`, argumentos como vetor. `branch`/`dir` já eram
 * gerados por código nosso (fatia de UUID + `tmpdir()`), nunca de payload externo — mas
 * "seguro hoje" não é "impossível de errar amanhã", e manter uma segunda forma de chamar git
 * só para este caso seria a mesma exceção que este plano existe para eliminar.
 *
 * `prefixo` diferencia o branch/diretório por chamador (`sessao` para a sessão supervisionada,
 * `cmd` para `run_command`) — dois mecanismos batendo no mesmo `rayzen/sessao-<id>` colidiriam
 * se alguém reusasse o mesmo `id` por coincidência (improvável com UUID, mas gratuito de evitar).
 */
export async function criarWorktree(base: string, id: string, prefixo: string = 'sessao'): Promise<Worktree | null> {
  const opts = { cwd: base, env: ambientePadrao(), timeoutMs: 5000 }
  try {
    const r = await executarPrograma('executavel', 'git', ['rev-parse', '--git-dir'], opts)
    if (r.code !== 0) return null // não é repositório git
  } catch {
    return null
  }

  const branch = `rayzen/${prefixo}-${id.slice(0, 8)}`
  const dir    = join(tmpdir(), `rayzen-worktree-${prefixo}-${id.slice(0, 8)}`)

  try {
    const r = await executarPrograma(
      'executavel', 'git', ['worktree', 'add', '-b', branch, dir],
      { ...opts, timeoutMs: 30_000 },
    )
    if (r.code !== 0) return null
    return { dir, branch }
  } catch {
    return null
  }
}

/**
 * Existe trabalho não commitado no checkout? `null` quando NÃO FOI POSSÍVEL MEDIR — e essa
 * terceira resposta é a razão de a função existir separada do booleano.
 *
 * Mesma disciplina dos invariantes desta casa: um check que não consegue medir nunca devolve
 * sucesso. Aqui "sucesso" seria dizer "está limpo, pode apagar", que é exatamente a decisão
 * irreversível. Sem conseguir medir, o chamador preserva.
 */
async function trabalhoNaoCommitado(dir: string): Promise<boolean | null> {
  // Checkout que já não existe não tem trabalho a preservar — e responder `null` aqui
  // impediria a limpeza do BRANCH de um worktree removido à mão, que é caso legítimo.
  if (!existsSync(dir)) return false

  try {
    const r = await executarPrograma(
      'executavel', 'git', ['status', '--porcelain'],
      { cwd: dir, env: ambientePadrao(), timeoutMs: 10_000 },
    )
    if (r.code !== 0 || r.timedOut) return null
    return r.stdout.trim().length > 0
  } catch {
    return null
  }
}

/**
 * A divisão que torna a limpeza segura opera em DOIS degraus, e até 13/09 só o segundo existia.
 *
 * **Degrau 1 — trabalho que ainda não virou commit.** `git worktree remove` sem `--force` já
 * RECUSA remover um checkout sujo: a trava é do git, não nossa. Até 13/09 esta função passava
 * `--force`, que desliga exatamente essa recusa — e o comentário que ficava aqui explicava
 * corretamente por que a limpeza era segura ("só libera o checkout; os commits continuam
 * alcançáveis pelo branch"), sem notar que a premissa valia só para o que JÁ É commit. A
 * auditoria de 13/09 (A01) reproduziu a perda com Git real: alteração tracked e arquivo novo
 * apagados, sem nada recusar. Agora a sujeira é medida ANTES, e o checkout é preservado inteiro.
 *
 * Preservar em vez de commitar automaticamente é decisão explícita: commit automático varre
 * para dentro do histórico arquivo que ninguém revisou — o mesmo tipo de conveniência que já
 * colocou o `AGENT_TOKEN` num commit de bootstrap nesta casa.
 *
 * **Degrau 2 — commit ainda não mesclado.** `git branch -d` (minúsculo, nunca `-D`) é quem
 * decide: o próprio git recusa apagar branch com commit não alcançável de outro lugar.
 *
 * Best-effort dos dois lados quando a remoção de fato acontece: falha ao remover o worktree
 * (diretório já sumiu, por exemplo) não impede a tentativa de apagar o branch, e vice-versa.
 *
 * `preservadoPorWip` existe para quem chama poder dizer ao humano ONDE o trabalho ficou —
 * preservar em silêncio seria trocar perda de dados por trabalho esquecido em `tmpdir()`.
 */
export async function removerWorktree(
  base: string,
  wt: Worktree,
): Promise<{ dirRemovido: boolean; branchRemovido: boolean; preservadoPorWip?: boolean }> {
  const opts = { cwd: base, env: ambientePadrao(), timeoutMs: 15_000 }

  // Não conseguir medir conta como sujo: a dúvida nunca autoriza a operação irreversível.
  const sujo = await trabalhoNaoCommitado(wt.dir)
  if (sujo !== false) {
    return { dirRemovido: false, branchRemovido: false, preservadoPorWip: true }
  }

  let dirRemovido = false
  try {
    const r = await executarPrograma('executavel', 'git', ['worktree', 'remove', wt.dir], opts)
    dirRemovido = r.code === 0
  } catch { /* melhor esforço — diretório já removido, ou outra falha não fatal */ }

  let branchRemovido = false
  try {
    const r = await executarPrograma('executavel', 'git', ['branch', '-d', wt.branch], opts)
    branchRemovido = r.code === 0
  } catch { /* melhor esforço */ }

  return { dirRemovido, branchRemovido }
}
