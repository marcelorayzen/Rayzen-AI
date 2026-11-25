import { readFileSync } from 'fs'
import { join } from 'path'
import { pedeAcaoNoFuturo, respostaSemAgendadorAbsoluto, atrasoDoPedido } from '../pedido-agendado'

/**
 * ── O sistema convidava o pedido que não consegue honrar ─────────────────────
 *
 * O SOUL diz: *"Sem mecanismo ativo para lembrar, monitorar ou agir depois, digo isso em vez de
 * prometer acompanhamento."* Medido em 15/09, não havia mecanismo nenhum atrás disso — e o prompt
 * do classificador listava `"me notifica daqui 10 min"` entre os exemplos de jarvis.
 *
 * `jarvis:notify` recebe `{ title, message }`. Não tem atraso. Não existe agendador na API;
 * `ProactiveService` calcula sob demanda, é pull. O pedido era aceito, roteado, e o toast
 * disparava NA HORA.
 *
 * Mesma lição de quando se tirou do SOUL o *"apresentar resultado em formato operacional"*:
 * proibição abstrata perde para instrução concreta. Lá a instrução concreta estava na personality;
 * aqui, no prompt do classificador.
 */
describe('pedido de ação no futuro é reconhecido', () => {
  it.each([
    ['me notifica daqui 10 min', 'daqui 10 min'],
    ['me avisa daqui a 2 horas', 'daqui a 2 horas'],
    ['roda os testes em 30 minutos', 'em 30 minutos'],
    ['reinicia a api depois de 1 hora', 'depois de 1 hora'],
  ])('%p → reconhece "%s"', (prompt, trecho) => {
    expect(pedeAcaoNoFuturo(prompt)).toBe(trecho)
  })

  it.each([
    'tira um print amanhã',
    'reinicia a API às 15h',
    'roda os testes todo dia',
    'me notifica a cada 30 min',
    'faz o backup semana que vem',
  ])('%p pede futuro', (prompt) => {
    expect(pedeAcaoNoFuturo(prompt)).not.toBeNull()
  })

  /**
   * O falso-positivo é caro: recusaria uma ação que funciona. A âncora é o marcador de FUTURO,
   * nunca a unidade de tempo sozinha — por isso "últimas 2 horas" (passado) passa direto.
   */
  it.each([
    'mostra os logs das últimas 2 horas',
    'qual o status do PC',
    'tira um print da tela',
    'faz o deploy em produção',
    'lista os commits de hoje',
    'roda os testes do projeto X',
  ])('%p NÃO é pedido agendado', (prompt) => {
    expect(pedeAcaoNoFuturo(prompt)).toBeNull()
  })

  /**
   * A recusa cita o que entendeu. "Não consigo agendar" sem dizer o quê é indistinguível de uma
   * recusa genérica, e o usuário não descobre se o problema foi a ação ou o horário.
   */
  it('a recusa cita o trecho e diz qual das duas coisas faltou', () => {
    const r = respostaSemAgendadorAbsoluto('amanha as 9h')
    expect(r).toContain('amanha as 9h')
    // Recusa a HORA, nao a capacidade: o agendamento relativo passou a existir em 17/09.
    expect(r).toMatch(/tempo relativo/i)
    expect(r).toMatch(/fuso/i)
    expect(r).not.toMatch(/n[ãa]o tenho mecanismo/i)
  })
})

/**
 * O exemplo no prompt do classificador é a instrução concreta que vencia a proibição abstrata.
 * Enquanto ele estiver lá, o sistema continua convidando o pedido — e a frase do SOUL continua
 * sendo enunciado sem mecanismo.
 */
describe('o classificador não oferece agendamento', () => {
  const fonte = readFileSync(join(__dirname, '..', 'orchestrator.service.ts'), 'utf8')

  /**
   * Olha a LINHA do prompt, não o arquivo: o comentário que explica o conserto cita o exemplo
   * antigo, e um teste sobre o arquivo inteiro proibiria documentar o próprio defeito.
   */
  const linhaDeExemplos = /^Exemplos jarvis:.*$/m.exec(fonte)?.[0] ?? ''

  it('encontra a linha de exemplos do classificador', () => {
    expect(linhaDeExemplos).toContain('qual o status do PC')
  })

  it('nenhum exemplo promete ação no futuro', () => {
    expect(pedeAcaoNoFuturo(linhaDeExemplos)).toBeNull()
  })

  it('a recusa por falta de agendador está ligada ao caminho jarvis', () => {
    expect(fonte).toMatch(/pedeAcaoNoFuturo\(prompt\)/)
    expect(fonte).toMatch(/respostaSemAgendadorAbsoluto/)
  })
})

/**
 * ── O agendador existia e eu não tinha olhado (17/09) ────────────────────────
 *
 * Eu afirmei que "não existe agendador em lugar nenhum da API". Estava errado pela mesma razão do
 * disco: olhei o CÓDIGO da aplicação e não a INFRAESTRUTURA que ela já usa. O Bull aceita `delay`
 * e `repeat` desde sempre — medido em produção:
 *
 *     job com delay criado: 1 | delay suportado: sim
 *     repeatable suportado: true | *\/5 * * * *
 *
 * O que faltava era um degrau abaixo: `claimTask` lia `getJobs(['waiting','delayed'])` e teria
 * entregue o job atrasado NA HORA. Ver `jaEstaNaHora()` em `agent-bridge.service.ts`.
 */
describe('atrasoDoPedido — só o que não é ambíguo', () => {
  it.each([
    ['me notifica daqui 10 min', 10 * 60_000],
    ['me avisa daqui a 2 horas', 2 * 3_600_000],
    ['roda os testes em 30 minutos', 30 * 60_000],
    ['tira um print depois de 1 hora', 3_600_000],
    ['faz o backup em 2 dias', 2 * 86_400_000],
  ])('%p → %i ms', (prompt, ms) => {
    expect(atrasoDoPedido(prompt)?.ms).toBe(ms)
  })

  /**
   * Horário de relógio exigiria o fuso do usuário, que não existe no modelo de dados — o servidor
   * roda em UTC e Marcelo está em BRT. Errar por três horas é pior que recusar.
   */
  it.each(['tira um print amanhã', 'reinicia a API às 15h', 'faz o backup semana que vem'])(
    '%p é futuro, mas NÃO agenda — a hora é ambígua',
    (prompt) => {
      expect(pedeAcaoNoFuturo(prompt)).not.toBeNull()
      expect(atrasoDoPedido(prompt)).toBeNull()
    },
  )

  /** `delay` agenda UMA vez. Job repetível sem tela para listar e desligar vira lixo permanente. */
  it.each(['roda os testes todo dia', 'me notifica a cada 30 min'])(
    '%p é recorrente — recusa em vez de agendar uma vez só',
    (prompt) => {
      expect(atrasoDoPedido(prompt)).toBeNull()
    },
  )

  it('acima de 7 dias não agenda — `delay` viraria aposta sobre o processo viver', () => {
    expect(atrasoDoPedido('me avisa em 6 dias')).not.toBeNull()
    expect(atrasoDoPedido('me avisa em 30 dias')).toBeNull()
  })

  it('pedido sem futuro nenhum não vira agendamento', () => {
    expect(atrasoDoPedido('qual o status do PC')).toBeNull()
    expect(atrasoDoPedido('mostra os logs das últimas 2 horas')).toBeNull()
  })
})
