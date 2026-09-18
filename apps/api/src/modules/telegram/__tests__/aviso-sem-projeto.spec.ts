import { TelegramService, AVISO_SEM_PROJETO, TELEGRAM_MAX_CHARS } from '../telegram.service'

/**
 * O caminho de texto livre respondia SEM contexto de projeto e não dizia.
 *
 * Os quatro comandos — `/status`, `/goal`, `/eventos`, `/checkpoint` — já guardavam com
 * `if (!pid) send('Nenhum projeto selecionado. Use /projeto.')`. O texto livre, que é o
 * caminho usado o tempo todo, chamava `orchestrate` com `projectId` indefinido, e
 * `getProjectContext` devolvia string vazia.
 *
 * O comportamento não era corrupção: não existe default silencioso, nada ia para o
 * projeto errado. Era pior de outro jeito — **inanição silenciosa de contexto**. A
 * conversa responde como se soubesse, sem objetivo, memória, eventos nem políticas, e
 * nada denuncia. Medido em 2026-09-05: os caminhos protegidos eram os raros, o
 * desprotegido era o comum.
 *
 * Mesma família do `falhas[]` do ContextEngine e da linha de frescor do ProjectState:
 * quando o sistema sabe que está incompleto, ele diz.
 */
describe('TelegramService — resposta sem projeto se declara', () => {
  const svc = Object.create(TelegramService.prototype) as TelegramService
  const comAviso = (reply: string, projectId: string | null) =>
    (svc as unknown as { comAvisoDeProjeto: (r: string, p: string | null) => string })
      .comAvisoDeProjeto(reply, projectId)

  it('sem projeto: a resposta diz que saiu sem contexto', () => {
    const saida = comAviso('Resposta qualquer.', null)
    expect(saida).toContain('Resposta qualquer.')
    expect(saida).toContain(AVISO_SEM_PROJETO)
  })

  it('com projeto: nenhum aviso — senão vira ruído em toda mensagem', () => {
    const saida = comAviso('Resposta qualquer.', 'p1')
    expect(saida).toBe('Resposta qualquer.')
    expect(saida).not.toContain('⚠️')
  })

  /**
   * O aviso nomeia a CONSEQUÊNCIA, não só o estado. "Nenhum projeto selecionado" diz o
   * que falta; "respondido sem contexto" diz por que a resposta veio pobre — que é a
   * informação que muda o que a pessoa faz em seguida.
   */
  it('o aviso explica a consequência e o conserto', () => {
    expect(AVISO_SEM_PROJETO).toMatch(/sem contexto/i)
    expect(AVISO_SEM_PROJETO).toMatch(/\/projeto/)
  })

  /**
   * O corte tem que reservar espaço para o aviso. Cortar em 4000 e depois concatenar
   * estoura o limite do Telegram — e a mensagem que se perderia seria justamente o
   * aviso, no fim.
   */
  it('resposta longa sem projeto nao estoura o limite, e o aviso sobrevive', () => {
    const saida = comAviso('x'.repeat(10_000), null)
    expect(saida.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS)
    expect(saida).toContain(AVISO_SEM_PROJETO)
  })

  it('resposta longa com projeto usa o limite inteiro', () => {
    expect(comAviso('x'.repeat(10_000), 'p1')).toHaveLength(TELEGRAM_MAX_CHARS)
  })

  it('resposta vazia sem projeto ainda avisa — o silencio nao pode ser a resposta', () => {
    expect(comAviso('', null)).toContain(AVISO_SEM_PROJETO)
  })
})
