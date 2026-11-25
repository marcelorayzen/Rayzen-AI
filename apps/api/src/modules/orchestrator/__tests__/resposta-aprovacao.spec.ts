import { readFileSync } from 'fs'
import { join } from 'path'
import { classificarResposta } from '../resposta-aprovacao.const'

/**
 * ── O card oferecia uma opção que o próprio parser não aceitava ──────────────
 *
 * Primeiro teste real da jornada integrada pelo Telegram, 15/09. O bot respondeu
 * *"Confirme para executar ou cancele para abortar"*, e a resposta foi:
 *
 *     Confirmo
 *
 * `^(confirmar|confirma|sim|ok|pode|executar|executa|yes|run)$` não casa "confirmo" — lista
 * fechada e ancorada. A mensagem caiu na classificação normal (`module: system` no registro, não
 * `jarvis`) e o modelo respondeu *"não consigo capturar ou enviar imagens da tela"*, inventando
 * uma incapacidade que ele tinha oferecido uma mensagem antes.
 *
 * É o A02 no caminho ao lado. Lá eram "Aprovado, continue" e "Rejeitar e corrigir" — as opções que
 * o próprio bot numerava — caindo ambas em "instrução modificada". Aqui é o verbo do próprio card,
 * conjugado na primeira pessoa.
 */
describe('decisão de confirmação do orquestrador', () => {
  it('"Confirmo" aprova — o caso que quebrou em produção', () => {
    expect(classificarResposta('Confirmo')).toBe('aprovado')
  })

  /**
   * Acrescentar "confirmo" à lista fechada teria consertado o caso e deixado o defeito: a
   * próxima conjugação seria o próximo incidente.
   */
  it.each([
    'confirmar', 'confirma', 'confirmado', 'Confirmo!',
    'pode executar', 'pode mandar', 'sim, pode',
    'aprovado', 'aprovo', 'beleza', 'ok', 'certo', 'isso', 'manda ver', 'segue',
  ])('"%s" aprova', (texto) => {
    expect(classificarResposta(texto)).toBe('aprovado')
  })

  it.each(['cancelar', 'cancela', 'não', 'nao', 'nem', 'no', 'não!', 'nao pode', 'não confirmo', 'rejeitar', 'pare'])(
    '"%s" rejeita',
    (texto) => {
      expect(classificarResposta(texto)).toBe('rejeitado')
    },
  )

  /** A regra que mais importa: negação nunca vira aprovação. */
  it.each(['não pode', 'nao confirmo', 'não continue', 'nunca'])(
    '"%s" nunca aprova',
    (texto) => {
      expect(classificarResposta(texto)).not.toBe('aprovado')
    },
  )

  it('silêncio é valor próprio, não aprovação', () => {
    expect(classificarResposta('')).toBe('sem_resposta')
    expect(classificarResposta('   ')).toBe('sem_resposta')
    expect(classificarResposta(null)).toBe('sem_resposta')
    expect(classificarResposta(undefined)).toBe('sem_resposta')
  })

  it('pedido diferente é instrução, não confirmação nem cancelamento', () => {
    expect(classificarResposta('tira o print do outro monitor')).toBe('instrucao')
    expect(classificarResposta('e qual o status do PC?')).toBe('instrucao')
  })
})

/**
 * ── Anti-drift ───────────────────────────────────────────────────────────────
 *
 * A implementação canônica é `apps/agent/src/actions/resposta-aprovacao.ts` (A02). Esta cópia
 * existe porque `@rayzen/types` não é compilado — importar valor de lá derruba o container, a
 * mesma razão de `memory-ranking.const.ts` e `event-derived-text.const.ts`.
 *
 * Duas listas de aprovação que discordam são duas políticas de autorização, e foi exatamente esse
 * o defeito: a de cá aceitava menos que a de lá, na rota que o usuário usa todo dia.
 */
describe('anti-drift com a implementação do agent', () => {
  const CANONICO = join(__dirname, '..', '..', '..', '..', '..', 'agent', 'src', 'actions', 'resposta-aprovacao.ts')
  const COPIA    = join(__dirname, '..', 'resposta-aprovacao.const.ts')

  /** Corpo de uma regex nomeada, como texto — é o que precisa ser idêntico. */
  function regexDe(fonte: string, nome: string): string | null {
    return new RegExp(`const ${nome} = (/.*/)\\n`).exec(fonte)?.[1] ?? null
  }

  it('encontra os dois arquivos', () => {
    expect(readFileSync(CANONICO, 'utf8').length).toBeGreaterThan(500)
    expect(readFileSync(COPIA, 'utf8').length).toBeGreaterThan(500)
  })

  it.each(['INDICE', 'NEGADOR', 'REJEICAO', 'APROVACAO', 'SO_NEGACAO'])(
    'a regex %s é idêntica nos dois',
    (nome) => {
      const doAgent = regexDe(readFileSync(CANONICO, 'utf8'), nome)
      const daApi   = regexDe(readFileSync(COPIA, 'utf8'), nome)

      expect(doAgent).not.toBeNull()
      expect(daApi).toBe(doAgent)
    },
  )
})
