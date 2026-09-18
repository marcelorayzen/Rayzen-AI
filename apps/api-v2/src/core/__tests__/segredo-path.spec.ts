import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ehCaminhoDeSegredo } from '../segredo-path.const'

/**
 * A regra existe duas vezes de propósito, e o drift é barrado aqui.
 *
 * Na V1 ela impede que o hook INDEXE o arquivo; aqui ela AUDITA o acervo que já existe.
 * São perguntas diferentes com o mesmo critério — e é justamente esse tipo de par que
 * diverge em silêncio. `memory-ranking` já discordou em três dos cinco modos antes de
 * ter teste.
 *
 * `packages/types` não serve: não é compilado, e importar valor de lá derruba o container.
 */
describe('segredo-path — cópia V1/V2 não pode divergir', () => {
  const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
  const ORIGEM_V1 = 'apps/api/src/modules/memory/indexable-path.const.ts'

  /**
   * Extrai a declaração do regex e o corpo da função, ignorando comentário e indentação.
   * Comparar o arquivo inteiro não serviria: o da V1 carrega cinco outras categorias que
   * não têm par aqui.
   */
  const essencia = (fonte: string) => {
    const regex = fonte.match(/const SEGREDO = (\/.*\/i)/)?.[1] ?? null
    const corpo = fonte
      .slice(fonte.indexOf('export function ehCaminhoDeSegredo'))
      .split('\n')
      .slice(0, 6)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
    return { regex, corpo }
  }

  it('a V1 declara exatamente o mesmo regex e a mesma função', () => {
    const v1 = essencia(readFileSync(join(REPO_ROOT, ORIGEM_V1), 'utf8'))
    const v2 = essencia(readFileSync(join(__dirname, '..', 'segredo-path.const.ts'), 'utf8'))

    expect(v1.regex).not.toBeNull()
    expect(v2.regex).toEqual(v1.regex)
    expect(v2.corpo).toEqual(v1.corpo)
  })
})

describe('ehCaminhoDeSegredo', () => {
  it.each([
    'apps/agent/src/hooks/hook.config.mjs',
    'C:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\apps\\agent\\src\\hooks\\hook.config.mjs',
    'proj/.env',
    'proj/.env.production',
    'apps/web/.env.local',
    'infra/certs/server.pem',
    '~/.ssh/id_ed25519',
    '.credentials.json',
  ])('acusa: %s', (p) => expect(ehCaminhoDeSegredo(p)).toBe(true))

  /**
   * `.example` fica de fora DE PROPÓSITO — é template versionado, e é o que ensina o
   * formato a quem chega. Quando os dois documentos reais foram apagados do Brain em
   * 2026-09-10, os dois `.example` foram preservados.
   */
  it.each([
    'apps/agent/src/hooks/hook.config.example.mjs',
    'proj/.env.example',
    '.env.agent.server.example',
  ])('não acusa template: %s', (p) => expect(ehCaminhoDeSegredo(p)).toBe(false))

  it.each([
    'apps/api/src/modules/memory/memory.service.ts',
    'CLAUDE.md',
    'package.json',
  ])('não acusa arquivo comum: %s', (p) => expect(ehCaminhoDeSegredo(p)).toBe(false))

  it('caminho ausente não é segredo', () => {
    expect(ehCaminhoDeSegredo('')).toBe(false)
    expect(ehCaminhoDeSegredo(null)).toBe(false)
    expect(ehCaminhoDeSegredo(undefined)).toBe(false)
  })
})
