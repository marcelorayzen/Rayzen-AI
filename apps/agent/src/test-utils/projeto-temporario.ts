import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'

/**
 * Diretório descartável dentro de um safe root, e a limpeza dele.
 *
 * ── Por que sob `~/Projects` e não sob `%TEMP%` ──────────────────────────────
 * `isUnderSafeRoot()` recusa qualquer caminho fora de `SAFE_ROOTS`, e `%TEMP%` fica de fora
 * de propósito. O fixture precisa nascer onde a ação sob teste aceitaria trabalhar, senão o
 * teste mede o path-guard em vez de medir a ação.
 *
 * ── Por que existe um lugar só ───────────────────────────────────────────────
 * Nove specs reimplementavam `base + mkdirSync + mkdtempSync`, cada um com o seu prefixo e a
 * sua limpeza. Em 24/09 a medição encontrou **12 diretórios abandonados** em `~/Projects` —
 * e o motivo estava na limpeza, não na criação: o `afterEach` chamava `rmSync` dentro de um
 * `try` com `catch` vazio, engolindo o `EBUSY` que o Windows levanta enquanto o git ainda
 * segura um handle. Falhava calado, e ninguém via.
 *
 * Duas coisas mudam aqui: `rmSync` ganha `maxRetries`/`retryDelay` (o remédio que o Item A.3
 * já tinha descoberto, e que valia num arquivo só), e a falha **avisa** em vez de sumir.
 * Continua sem lançar — derrubar um teste verde por causa de limpeza troca um defeito
 * invisível por ruído —, mas deixa de ser invisível.
 *
 * ── O prefixo é o contrato com o sensor ──────────────────────────────────────
 * Todo diretório nasce como `rayzen-teste-<nome>-XXXXXX`. `pnpm check:local` procura por esse
 * prefixo e acusa o que sobrou: limpeza por spec já provou não bastar, e o que garante que
 * não volte a acumular é medir o resultado, não confiar na disciplina de cada arquivo.
 *
 * Marcador em ARQUIVO foi descartado: vários destes fixtures conferem `git status`, e um
 * arquivo a mais apareceria como não rastreado dentro do próprio teste.
 */
export const PREFIXO_DE_TESTE = 'rayzen-teste-'

export function raizDeProjetos(): string {
  return join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
}

export function criarProjetoTemporario(nome: string): string {
  const base = raizDeProjetos()
  // No runner do CI (Linux, `$HOME=/home/runner`) esta pasta não existe por padrão, e
  // `mkdtempSync` exige que o pai já exista. Na máquina de dev é no-op.
  mkdirSync(base, { recursive: true })
  return mkdtempSync(join(base, `${PREFIXO_DE_TESTE}${nome}-`))
}

export function removerProjetoTemporario(dir: string): void {
  try {
    // Até 2s de paciência. Medido em 24/09: com 5×100ms um fixture de `git worktree` ainda
    // sobrou na primeira execução real do sensor — worktree segura handle por mais tempo que
    // um repositório simples, e o custo de esperar só existe quando a remoção falharia.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (e) {
    console.warn(`[teste] não consegui remover ${dir}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
