import { readFileSync } from 'fs'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { FERRAMENTAS_PERMITIDAS, FERRAMENTAS_NEGADAS, instrucoesDeMerge } from '../supervised-session'
import { criarWorktree } from '../../exec/workspace-isolado'

/**
 * A sessão supervisionada rodava com `--dangerously-skip-permissions` e no MESMO
 * diretório em que o dono estava trabalhando.
 *
 * ── O que a medição contra o CLI 2.1.158 mostrou, em 2026-09-06 ──────────────────
 *
 *  1. `--permission-prompts` NÃO existe nesta versão (a doc diz v2.1.259+). O desenho
 *     que eu ia escrever usava uma flag inexistente.
 *  2. Em modo `-p` a aprovação é PERMISSIVA: com apenas `--allowedTools Read`, um `Write`
 *     criou o arquivo em 11s. Não trava esperando prompt, e não restringe.
 *  3. `--disallowedTools` bloqueia de verdade — e bloqueia **mesmo com o bypass ligado**.
 *
 * Conclusão que inverte a intuição: **a lista de NEGAÇÃO é a proteção**. Tirar o bypass é
 * higiene. Estes testes protegem a lista, não a flag.
 */
describe('supervised-session — permissões', () => {
  const fonte = readFileSync(join(__dirname, '..', 'supervised-session.ts'), 'utf8')

  /**
   * A asserção é sobre a CHAMADA, não sobre o arquivo: o comentário acima da lista cita
   * a flag de propósito, para explicar o que foi substituído e por quê. A primeira versão
   * deste teste procurava a string no arquivo inteiro e falhava na própria documentação.
   */
  it('não invoca mais o bypass de permissões', () => {
    const chamada = fonte.match(/spawn\('claude',\s*\[[\s\S]*?\]/)?.[0] ?? ''
    expect(chamada).toBeTruthy()
    expect(chamada).not.toContain('--dangerously-skip-permissions')
  })

  it('passa as duas listas para o CLI', () => {
    expect(fonte).toMatch(/'--allowedTools',\s*\.\.\.FERRAMENTAS_PERMITIDAS/)
    expect(fonte).toMatch(/'--disallowedTools',\s*\.\.\.FERRAMENTAS_NEGADAS/)
  })

  /**
   * A negação mais importante da lista, e é específica deste repositório: `git push` em
   * `main` dispara build e deploy em produção via webhook. Um push entre dois
   * checkpoints publica antes de qualquer um revisar.
   */
  it('nega `git push` — aqui push é deploy', () => {
    expect(FERRAMENTAS_NEGADAS).toContain('Bash(git push:*)')
  })

  it.each(['Bash(rm:*)', 'Bash(sudo:*)', 'Bash(docker:*)', 'Bash(curl:*)', 'Bash(git reset --hard:*)'])(
    'nega %s — irreversível ou fala para fora',
    (padrao) => expect(FERRAMENTAS_NEGADAS).toContain(padrao),
  )

  it.each(['Read', 'Edit', 'Write', 'Bash(git commit:*)', 'Bash(pnpm:*)'])(
    'permite %s — é o trabalho da sessão',
    (padrao) => expect(FERRAMENTAS_PERMITIDAS).toContain(padrao),
  )

  /**
   * `WebFetch` e `WebSearch` ficam FORA da negação de propósito: são somente-leitura,
   * registradas, e pesquisar documentação é trabalho legítimo. Negar por reflexo
   * tornaria a sessão pior sem tornar nada mais seguro.
   */
  it('NÃO nega pesquisa na web — leitura registrada não é exfiltração', () => {
    expect(FERRAMENTAS_NEGADAS).not.toContain('WebFetch')
    expect(FERRAMENTAS_NEGADAS).not.toContain('WebSearch')
  })

  it('nenhum padrão aparece nas duas listas ao mesmo tempo', () => {
    const conflito = FERRAMENTAS_PERMITIDAS.filter((p) => FERRAMENTAS_NEGADAS.includes(p))
    expect(conflito).toEqual([])
  })

  /**
   * `Bash(pnpm:*)` é largo e cobriria `pnpm publish`. A negação específica tem
   * precedência — e este teste existe para lembrar que a largura é deliberada: estreitar
   * demais quebra a sessão no primeiro comando legítimo.
   */
  it('o padrão largo de pnpm/npm é acompanhado da negação de publish', () => {
    expect(FERRAMENTAS_PERMITIDAS).toContain('Bash(pnpm:*)')
    expect(FERRAMENTAS_NEGADAS).toContain('Bash(pnpm publish:*)')
    expect(FERRAMENTAS_NEGADAS).toContain('Bash(npm publish:*)')
  })
})

describe('supervised-session — isolamento por worktree', () => {
  /**
   * Isolamento é PROTEÇÃO, não pré-requisito. Numa pasta que não é repositório git a
   * sessão precisa continuar rodando, no diretório original — recusar seria trocar um
   * risco por uma indisponibilidade.
   */
  it('fora de um repositório git devolve null, e a sessão segue no diretório original', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'rayzen-sem-git-'))
    // Migrado para executarPrograma() na Fase 1 — criarWorktree agora é assíncrono.
    await expect(criarWorktree(pasta, 'abcdef1234')).resolves.toBeNull()
  })

  describe('instruções de merge', () => {
    const wt = { dir: '/tmp/rayzen-worktree-abcdef12', branch: 'rayzen/sessao-abcdef12' }
    const texto = instrucoesDeMerge('/repo', wt)

    /**
     * O branch NÃO é mesclado automaticamente — decisão de 2026-09-06. Mesclar sozinho
     * devolveria metade do valor do isolamento.
     */
    it('diz que nada foi escrito no diretório de trabalho', () => {
      expect(texto).toMatch(/Nada foi escrito no seu diretório de trabalho/)
    })

    /**
     * Item A.1 da varredura de 2026-09-12: o worktree (o CHECKOUT) deixou de precisar de
     * comando manual — `removerWorktree()` já libera em `finally`, sempre, porque remover o
     * checkout nunca perde commit nenhum. O que sobra para o humano é só o merge do branch,
     * que continua existindo até ser mesclado (git recusa apagar sozinho).
     */
    it.each([
      ['ver o diff', /git diff main\.\.\.rayzen\/sessao-abcdef12/],
      ['incorporar', /git merge rayzen\/sessao-abcdef12/],
      ['apagar o branch', /git branch -d rayzen\/sessao-abcdef12/],
      ['descartar', /git branch -D rayzen\/sessao-abcdef12/],
    ])('traz o comando para %s', (_rotulo, padrao) => expect(texto).toMatch(padrao))

    it('não instrui mais `git worktree remove` manual — isso já é automático', () => {
      expect(texto).not.toMatch(/git worktree remove/)
    })

    /**
     * Um branch que ninguém sabe que existe é igual a trabalho perdido. O diretório do
     * worktree não aparece mais aqui de propósito — ele já não existe mais quando o humano lê
     * isto (removido em `finally`), citá-lo seria apontar para um caminho morto.
     */
    it('nomeia o branch, para o trabalho não sumir', () => {
      expect(texto).toContain(wt.branch)
    })
  })
})
