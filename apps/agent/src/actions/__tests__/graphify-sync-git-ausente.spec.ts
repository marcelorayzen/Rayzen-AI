/**
 * `executarPrograma` REJEITA (não resolve com código de saída) quando o programa nem existe
 * no PATH — `spawn` emite `error` (ENOENT). A migração de `graphify-sync.ts` para
 * `executarPrograma` (Achado 0 da varredura de 2026-09-12) precisa tratar isso do mesmo jeito
 * que o `execSync` original tratava (try/catch, nunca propaga) — sem isso, uma máquina sem
 * `git`/`graphify` no PATH faria `graphifySync()` REJEITAR em vez de devolver a string de erro
 * que sempre devolveu. Isolado num arquivo próprio porque mocka `exec/executar-programa`
 * inteiro, o que quebraria os testes reais de `graphify-sync.spec.ts`.
 */
jest.mock('../../exec/executar-programa', () => ({
  executarPrograma: jest.fn().mockRejectedValue(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })),
  ambientePadrao: jest.fn().mockReturnValue({}),
}))

import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { graphifySync } from '../graphify-sync'

describe('graphifySync — git/graphify ausentes do PATH (rejeição, não código de saída)', () => {
  it('git ausente do PATH devolve a mensagem de erro, nunca rejeita', async () => {
    // Precisa de um `cwd` dentro de um safe root real, sem depender de onde o checkout deste
    // repositório mora — no runner do CI, `process.cwd()` (o próprio checkout) fica FORA de
    // qualquer safe root (`/home/runner/work/...`), e a chamada nunca chegaria a testar o
    // ENOENT: seria recusada antes, por path-guard. Na máquina de dev o checkout mora dentro de
    // `~/Projects`, o que mascarava essa dependência.
    const base = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
    mkdirSync(base, { recursive: true })
    const dir = mkdtempSync(join(base, 'rayzen-graphify-git-ausente-'))
    try {
      await expect(graphifySync({ cwd: dir })).resolves.toBe('Erro: não está em um repositório git')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
