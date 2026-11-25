import { readFileSync } from 'fs'
import { join } from 'path'
import { idsAlertaveis, transicaoDoPanorama, textoDoPanorama, NAO_MEDIDO } from '../alerta-de-panorama'
import { blocoDeCiclos, blocoDeInvariantes, blocoDeServicos, montarPanorama } from '../panorama.const'
import type { Panorama, RespostaV1 } from '../panorama.const'

/**
 * ── O buraco que este alerta fecha ──────────────────────────────────────────
 *
 * Com a api V1 fora e o Postgres de pé, os quatro invariantes que a sondam devolvem
 * "inconclusivo = ok" e os outros não dependem dela: **18 de 18 verdes com a plataforma no chão.**
 * O `panorama` é a única coisa que mede `api_v1` — faltava alguém olhar por ele.
 */

const v1Viva = (): RespostaV1 => ({
  tipo:  'respondeu',
  corpo: { ok: true, services: { postgres: { ok: true }, redis: { ok: true } } },
})

const panoramaCom = (v1: RespostaV1, ciclos: Parameters<typeof blocoDeCiclos>[0] = [], bancoOk = true): Panorama =>
  montarPanorama(
    blocoDeServicos(v1),
    blocoDeCiclos(ciclos, bancoOk),
    blocoDeInvariantes(
      [{ projectId: 'p1', idadeH: 1, resultados: [{ id: 'x', titulo: 'x', ok: true, gravidade: 'alta' }] }],
      6,
    ),
  )

describe('idsAlertaveis — o que vale acordar alguém', () => {
  it('tudo de pé: conjunto vazio', () => {
    expect([...idsAlertaveis(panoramaCom(v1Viva()))]).toEqual([])
  })

  /** O caso que motivou o mecanismo inteiro. */
  it('V1 fora entra como serviço alertável', () => {
    const ids = idsAlertaveis(panoramaCom({ tipo: 'semResposta', erro: 'ECONNREFUSED' }))
    expect([...ids]).toContain('servico:api_v1')
  })

  it('ciclo parado entra; ciclo que nunca subiu (baixa) não', () => {
    const ids = idsAlertaveis(panoramaCom(v1Viva(), [
      { id: 'invariants', titulo: 'inv', estado: 'sem-noticia', lastError: null },
      { id: 'guardian',   titulo: 'gd',  estado: 'nunca-subiu', lastError: null },
    ]))
    expect([...ids]).toEqual(['ciclo:invariants'])
  })

  it('bloco que não pôde ser medido vira alerta próprio', () => {
    const ids = idsAlertaveis(panoramaCom(v1Viva(), [], false))
    expect([...ids]).toContain(`${NAO_MEDIDO}ciclos`)
  })

  /**
   * ── O que fica de fora, e é decisão ──────────────────────────────────────
   *
   * O ciclo dos invariantes já empurra transição de gravidade `alta` por projeto. Repetir aqui
   * mandaria DUAS mensagens pelo mesmo fato, que é o modo pelo qual um alerta deixa de ser lido.
   */
  it('invariante quebrado NÃO entra — quem avisa por ele é o ciclo dos invariantes', () => {
    const p = montarPanorama(
      blocoDeServicos(v1Viva()),
      blocoDeCiclos([], true),
      blocoDeInvariantes(
        [{ projectId: 'p1', idadeH: 1, resultados: [{ id: 'jina', titulo: 'jina', ok: false, gravidade: 'alta' }] }],
        6,
      ),
    )
    expect(p.invariantes.estado).toBe('quebrado')   // aparece no painel
    expect([...idsAlertaveis(p)]).toEqual([])        // e não duplica o aviso
  })

  /** Serviço e ciclo podem ter o mesmo nome; sem prefixo um sumiria da conta do outro. */
  it('ids são prefixados por bloco', () => {
    const ids = idsAlertaveis(panoramaCom(
      { tipo: 'respondeu', corpo: { ok: false, services: { api_v2: { ok: false, error: 'x' } } } },
      [{ id: 'api_v2', titulo: 'c', estado: 'falhando', lastError: 'y' }],
    ))
    expect([...ids].sort()).toEqual(['ciclo:api_v2', 'servico:api_v2'])
  })
})

describe('transicaoDoPanorama', () => {
  it('surgiu agora: avisa', () => {
    const t = transicaoDoPanorama(new Set(['servico:api_v1']), new Set())
    expect(t.surgiram).toEqual(['servico:api_v1'])
  })

  /** Sem isto o alerta sairia a cada 5 minutos e viraria ruído conhecido. */
  it('continua quebrado: silêncio', () => {
    const t = transicaoDoPanorama(new Set(['servico:api_v1']), new Set(['servico:api_v1']))
    expect(t.surgiram).toEqual([])
    expect(t.sumiram).toEqual([])
  })

  it('voltou: avisa a recuperação', () => {
    const t = transicaoDoPanorama(new Set(), new Set(['servico:api_v1']))
    expect(t.sumiram).toEqual(['servico:api_v1'])
  })

  /**
   * Um restart com algo já quebrado anunciaria a falha preexistente como recém-acontecida, e um
   * alerta que mente sobre QUANDO algo quebrou é pior que nenhum. A continuidade real vem do
   * batimento persistido — ver `alertavelPersistido()`.
   */
  it('sem conjunto anterior não inventa transição', () => {
    const t = transicaoDoPanorama(new Set(['servico:api_v1', 'ciclo:invariants']), null)
    expect(t.surgiram).toEqual([])
    expect(t.sumiram).toEqual([])
  })
})

describe('textoDoPanorama', () => {
  it('nomeia o problema com título e detalhe', () => {
    const p = panoramaCom({ tipo: 'semResposta', erro: 'ECONNREFUSED' })
    const texto = textoDoPanorama(p, transicaoDoPanorama(idsAlertaveis(p), new Set()))!
    expect(texto).toContain('A API V1 responde')
    expect(texto).toContain('ECONNREFUSED')
  })

  it('anuncia a recuperação pelo nome', () => {
    const p = panoramaCom(v1Viva())
    const texto = textoDoPanorama(p, transicaoDoPanorama(new Set(), new Set(['servico:api_v1'])))!
    expect(texto).toMatch(/voltou ao normal.*api_v1/)
  })

  it('nada mudou: nenhuma mensagem', () => {
    expect(textoDoPanorama(panoramaCom(v1Viva()), { surgiram: [], sumiram: [] })).toBeNull()
  })
})

/**
 * ── A ligação, que é onde o defeito moraria ─────────────────────────────────
 *
 * Testar só as funções deixaria sem sensor a distância entre elas e o ciclo — mesma lição de
 * `notificar-transicao.spec.ts` e `fontes-de-contexto`.
 */
describe('o ciclo usa o mecanismo', () => {
  const fonte = readFileSync(join(__dirname, '..', 'panorama.service.ts'), 'utf8')

  it('o ciclo compara e notifica', () => {
    expect(fonte).toMatch(/transicaoDoPanorama\(agora, anterior\)/)
    expect(fonte).toMatch(/enviarAoTelegram\(texto\)/)
  })

  /**
   * A memória vem primeiro porque está sempre certa para o processo vivo — inclusive com o banco
   * fora, que é um dos casos que este ciclo precisa conseguir anunciar. O persistido é o que dá
   * continuidade depois de um restart.
   */
  it('o estado anterior tem memória E persistência, nessa ordem', () => {
    expect(fonte).toMatch(/this\.ultimoAlertavel \?\? \(await this\.alertavelPersistido\(\)\)/)
  })

  /** `beat` em `finally` — um ciclo que lança antes de reportar fica idêntico a um que nunca subiu. */
  it('bate em finally, com o conjunto no detalhe', () => {
    const fim = fonte.slice(fonte.indexOf('} finally {'), fonte.indexOf('} finally {') + 300)
    expect(fim).toMatch(/beat\('panorama'/)
    expect(fim).toMatch(/alertaveis/)
  })

  /**
   * `enviarAoTelegram` devolve se o Telegram aceitou. Marcar `avisou = true` antes do await
   * afirmaria entrega a partir da intenção de entregar — e como a função falha em silêncio de
   * propósito, este campo é o ÚNICO rastro de que a mensagem saiu. Campo que sempre diz "sim"
   * não é rastro.
   */
  it('`avisou` vem do retorno do envio, não de ter tentado', () => {
    expect(fonte).toMatch(/avisou = await enviarAoTelegram\(texto\)/)
  })

  it('é desligável por env, como todo ciclo desta casa', () => {
    expect(fonte).toMatch(/PANORAMA_CYCLE_ENABLED === 'false'/)
  })
})

/**
 * ── O portão caído é achado GRAVE, não indisponibilidade ────────────────────
 *
 * `/api/health` do Hermes devolve `auth_required`. Um `false` ali significa que o portão de
 * autenticação parou de valer numa superfície que está na internet — e o Hermes só recusa o bind
 * aberto na SUBIDA, então uma configuração perdida em runtime não o derrubaria.
 *
 * O painel trata isso como serviço quebrado de propósito: melhor um alerta dizendo que o HUB está
 * fora do que um silêncio sobre o HUB estar aberto.
 */
describe('o HUB sem autenticação é tratado como problema', () => {
  const fonte = readFileSync(join(__dirname, '..', 'panorama.service.ts'), 'utf8')

  it('a sonda do HUB reprova quando auth_required é false', () => {
    expect(fonte).toMatch(/auth_required === false/)
    expect(fonte).toMatch(/SEM AUTENTICAÇÃO/)
  })

  /** Sensor que depende de login falha junto com o login. */
  it('a sonda não usa credencial nenhuma', () => {
    const trecho = fonte.slice(fonte.indexOf('private async sondarHub'), fonte.indexOf('private async sondarHub') + 1200)
    expect(trecho).not.toMatch(/Authorization|Bearer|TOKEN/)
  })
})
