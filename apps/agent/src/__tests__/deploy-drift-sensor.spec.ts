import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { headDoRepo } from '../deploy-drift-sensor'

/**
 * O sensor de "build feito, troca não".
 *
 * A falha aconteceu duas vezes com 24 dias de intervalo — 2026-08-17 e 2026-09-10 — e as
 * duas com o mesmo disfarce: imagem nova ao lado de container velho, `docker compose ps`
 * dizendo `Up (healthy)`, painel verde, e o código empurrado fora do ar.
 *
 * Causa medida em 10/09: `execFile(..., { timeout: 600_000 })` no `triggerRemoteBuild`
 * estoura quando o build é frio, o cliente SSH morre e o **daemon do Docker termina as
 * imagens sozinho** — mas o `up -d` que viria depois nunca roda.
 */
describe('headDoRepo', () => {
  let raiz: string

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'rayzen-drift-'))
    mkdirSync(join(raiz, '.git', 'refs', 'heads'), { recursive: true })
  })

  afterEach(() => rmSync(raiz, { recursive: true, force: true }))

  it('lê o SHA do main sem precisar do binário git', () => {
    // O agent-server NÃO tem `git` instalado — só o repositório montado read-only.
    // Ler o ref direto é o que torna o sensor possível ali.
    writeFileSync(join(raiz, '.git', 'refs', 'heads', 'main'), 'f7fd85a114a75a192f2824e30be87aa60a126e5e\n')
    expect(headDoRepo(raiz)).toBe('f7fd85a')
  })

  it('repositório sem o ref devolve null, não lança', () => {
    expect(headDoRepo(raiz)).toBeNull()
  })

  it('caminho inexistente devolve null', () => {
    expect(headDoRepo(join(raiz, 'nao-existe'))).toBeNull()
  })

  /**
   * Conteúdo que não é SHA (um `ref:` de HEAD simbólico, lixo, arquivo vazio) devolve
   * null em vez de virar detalhe do heartbeat. Sujeira no painel é pior que ausência:
   * a ausência se lê como "não medi".
   */
  it.each([
    ['ref simbólico', 'ref: refs/remotes/origin/main\n'],
    ['vazio',         ''],
    ['lixo',          'nao-e-um-sha\n'],
  ])('%s não vira detalhe: devolve null', (_rotulo, conteudo) => {
    writeFileSync(join(raiz, '.git', 'refs', 'heads', 'main'), conteudo)
    expect(headDoRepo(raiz)).toBeNull()
  })
})

/**
 * A regra de decisão, isolada do socket do Docker.
 *
 * `divergiu` só é true quando os DOIS lados foram lidos e são diferentes. Não conseguir
 * medir devolve false de propósito — inconclusivo nunca vira falha, senão o painel passa
 * a mentir na direção oposta e se aprende a ignorá-lo.
 */
describe('regra de divergência', () => {
  const divergiu = (container: string | null, imagem: string | null) =>
    Boolean(container && imagem && container !== imagem)

  it('vermelho quando o container roda imagem diferente da atual — o caso de 10/09', () => {
    expect(divergiu('sha256:402aec01ed969', 'sha256:dbb6b2686d936')).toBe(true)
  })

  it('verde quando batem — o estado depois do deploy manual de 10/09', () => {
    expect(divergiu('sha256:dbb6b2686d936', 'sha256:dbb6b2686d936')).toBe(false)
  })

  it.each([
    ['container ilegível', null, 'sha256:dbb6b2686d936'],
    ['imagem ausente',     'sha256:402aec01ed969', null],
    ['nenhum dos dois',    null, null],
  ])('%s NÃO é divergência — inconclusivo não vira falha', (_r, c, i) => {
    expect(divergiu(c, i)).toBe(false)
  })
})
