import { readFileSync } from 'fs'
import { join } from 'path'
import { quebradosAltos, transicoesAltas, textoDaTransicao, mudouAlgumEstado } from '../notificar-transicao'
import { InvariantResult } from '../invariant-checks.const'

/**
 * ── Invariante que ninguém lê não avisa ─────────────────────────────────────
 *
 * Em 17/09 a Jina ficou sem saldo e a memória semântica saiu do ar. O invariante
 * `embeddings_respondem` ficou vermelho **corretamente** — e ninguém soube: a descoberta foi por
 * acaso, investigando um deploy que falhara no dia anterior. Os invariantes gravam relatório e
 * aparecem no painel; nada empurra para o celular.
 *
 * As duas restrições testadas aqui **são o produto**:
 *
 * - **só na transição**, porque em 16/09 o `disco_com_folga` avisou em 85, 86, 88, 90, 92 e 95% e
 *   cada aviso foi lido como o anterior — até o disco encher e o Postgres entrar em laço de PANIC.
 *   Repetir o alerta é o mecanismo pelo qual ele deixa de funcionar;
 * - **só gravidade `alta`**, porque `registro_sem_projeto` é `media` e fica vermelho por desenho.
 */
const r = (id: string, ok: boolean, gravidade: 'alta' | 'media' | 'baixa' = 'alta'): InvariantResult => ({
  id,
  titulo:    `titulo de ${id}`,
  categoria: 'infra' as InvariantResult['categoria'],
  gravidade: gravidade as InvariantResult['gravidade'],
  ok,
  detalhe:   `detalhe de ${id}`,
})

describe('quebradosAltos — só o que é alta e está quebrado', () => {
  it('ignora quem está ok', () => {
    expect([...quebradosAltos([r('a', true), r('b', false)])]).toEqual(['b'])
  })

  /** `registro_sem_projeto` é `media` e vermelho por desenho — alertaria para sempre. */
  it('ignora gravidade menor que alta, mesmo quebrada', () => {
    const set = quebradosAltos([r('registro_sem_projeto', false, 'media'), r('disco', false, 'alta')])
    expect([...set]).toEqual(['disco'])
  })
})

describe('transicoesAltas — o alerta é sobre MUDANÇA', () => {
  it('quebrou agora: notifica', () => {
    const t = transicoesAltas([r('jina', false)], [r('jina', true)])
    expect(t.quebraram.map((x) => x.id)).toEqual(['jina'])
    expect(t.voltaram).toEqual([])
  })

  /**
   * O caso que mais importa: quebrado que segue quebrado é SILÊNCIO. Sem isto, o alerta chegaria
   * a cada 30min e viraria ruído conhecido — exatamente como os seis avisos de disco de 16/09.
   */
  it('continua quebrado: NÃO notifica de novo', () => {
    const t = transicoesAltas([r('jina', false)], [r('jina', false)])
    expect(t.quebraram).toEqual([])
    expect(t.voltaram).toEqual([])
  })

  it('voltou ao normal: notifica a recuperação', () => {
    const t = transicoesAltas([r('jina', true)], [r('jina', false)])
    expect(t.voltaram).toEqual(['jina'])
    expect(t.quebraram).toEqual([])
  })

  it('tudo ok antes e agora: silêncio', () => {
    const t = transicoesAltas([r('jina', true)], [r('jina', true)])
    expect(textoDaTransicao(t, 'projeto')).toBeNull()
  })

  /**
   * Sem relatório anterior, tratar tudo como novo faria a primeira execução depois de subir o
   * serviço anunciar toda falha preexistente como recém-acontecida. Alerta que mente sobre QUANDO
   * algo quebrou é pior que nenhum.
   */
  it('sem relatório anterior não inventa transição', () => {
    const t = transicoesAltas([r('jina', false), r('redis', false)], null)
    expect(t.quebraram).toEqual([])
    expect(t.voltaram).toEqual([])
  })

  it('média que quebra não gera alerta', () => {
    const t = transicoesAltas([r('registro', false, 'media')], [r('registro', true, 'media')])
    expect(t.quebraram).toEqual([])
  })
})

describe('mudouAlgumEstado — o que decide GRAVAR, em qualquer gravidade', () => {
  /** O caso exato de 17/09: media que se cura, e o registro tinha de acompanhar. */
  it('media que volta ao normal conta como mudança', () => {
    expect(mudouAlgumEstado([r('reg', true, 'media')], [r('reg', false, 'media')])).toBe(true)
  })

  it('media que quebra também conta', () => {
    expect(mudouAlgumEstado([r('reg', false, 'media')], [r('reg', true, 'media')])).toBe(true)
  })

  it('nada virou: não grava', () => {
    expect(mudouAlgumEstado([r('a', true), r('b', false)], [r('a', true), r('b', false)])).toBe(false)
  })

  /** Mesma razão de `transicoesAltas`: sem anterior, tudo pareceria recém-acontecido. */
  it('sem relatório anterior não inventa mudança', () => {
    expect(mudouAlgumEstado([r('a', false)], null)).toBe(false)
  })

  /** Invariante novo no catálogo não é mudança de estado — nunca teve estado antes. */
  it('invariante que não existia antes é ignorado', () => {
    expect(mudouAlgumEstado([r('a', true), r('novo', false)], [r('a', true)])).toBe(false)
  })
})

describe('textoDaTransicao', () => {
  it('traz título, detalhe e correção do que quebrou', () => {
    const quebrado: InvariantResult = { ...r('jina', false), correcao: 'repor credito' }
    const texto = textoDaTransicao(transicoesAltas([quebrado], [r('jina', true)]), 'Rayzen AI')!
    expect(texto).toContain('Rayzen AI')
    expect(texto).toContain('titulo de jina')
    expect(texto).toContain('detalhe de jina')
    expect(texto).toContain('repor credito')
  })

  /** Sem isso, quem recebeu o alerta vai ao painel para saber se ainda está quebrado. */
  it('anuncia a recuperação pelo nome', () => {
    const texto = textoDaTransicao(transicoesAltas([r('jina', true)], [r('jina', false)]), 'Rayzen AI')!
    expect(texto).toMatch(/voltou ao normal.*jina/i)
  })

  it('nada mudou: nenhuma mensagem', () => {
    expect(textoDaTransicao({ quebraram: [], voltaram: [] }, 'Rayzen AI')).toBeNull()
  })
})

/**
 * ── A ligação, que é onde o defeito moraria ─────────────────────────────────
 *
 * Testar só as funções deixaria sem sensor a distância entre elas e o ciclo — a mesma lição de
 * `fontes-de-contexto`. Dois pontos são verificados no texto do serviço porque envolvem controle
 * de fluxo que um teste unitário da função não alcança.
 */
describe('o ciclo usa o mecanismo, e só ele notifica', () => {
  const fonte = readFileSync(join(__dirname, '..', 'invariants.service.ts'), 'utf8')

  it('a notificação está no ciclo automático', () => {
    expect(fonte).toMatch(/transicoesAltas\(resultados, anteriores\)/)
    expect(fonte).toMatch(/enviarAoTelegram\(texto\)/)
  })

  /**
   * A mudança de estado precisa FORÇAR a gravação: sem isso, uma recuperação (falhas = 0) cairia
   * no `continue` sem persistir, o relatório anterior seguiria mostrando o problema, e o ciclo
   * seguinte anunciaria a mesma recuperação — para sempre.
   *
   * E é `mudouAlgumEstado`, **não** `transicao` — ver o teste de regressão abaixo.
   */
  it('a mudança de estado força a gravação do relatório', () => {
    expect(fonte).toMatch(/&& !houveMudanca\) continue/)
  })

  /**
   * ── Regressão de 17/09, e o painel foi quem denunciou ────────────────────
   *
   * A gravação já foi condicionada a `transicoesAltas`, que é só gravidade `alta`. Consequência
   * medida na primeira leitura real do `/v2/system/panorama`: o conserto do critério de órfãos
   * entrou às 21:44, `registro_sem_projeto` (que é `media`) ficou verde, e **o painel continuou
   * mostrando o problema** — a última linha gravada era de 21:28, e sem falha nem transição alta
   * nada forçava outra até o heartbeat de 6h.
   *
   * Restringir o ALERTA é para não treinar ninguém a ignorar. Isso não vale para o REGISTRO.
   */
  it('a gravação NÃO usa a restrição de gravidade do alerta', () => {
    const trecho = fonte.slice(fonte.indexOf('houveMudanca'), fonte.indexOf('houveMudanca') + 200)
    expect(trecho).not.toMatch(/transicao\.quebraram|transicao\.voltaram/)
  })

  /** Quem roda a mão já está olhando; notificar ali encheria o Telegram em qualquer depuração. */
  it('o run manual NÃO notifica', () => {
    const manual = fonte.slice(fonte.indexOf('async run('), fonte.indexOf('async run(') + 1800)
    expect(manual).not.toMatch(/enviarAoTelegram/)
  })
})
