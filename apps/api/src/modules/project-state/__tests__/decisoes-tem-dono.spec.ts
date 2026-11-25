import { readFileSync } from 'fs'
import { join } from 'path'
import { ProjectStateService } from '../project-state.service'

/**
 * ── `recentDecisions` tem dono determinístico, e não é o LLM ────────────────
 *
 * Medido no Rayzen AI em 19/09, em produção. O campo trazia cinco linhas:
 *
 *   "Recarregar o serviço Caddy" · "Commitar e pushar a correção de segurança"
 *   "Adicionar o bloco anonymous-API ao Caddyfile" · "Ativar o gate de escrita de skills"
 *
 * São **passos executados**. A decisão daquela hora foi outra — fechar por sessão em vez de por
 * caminho, porque um matcher de cookie se forja —, e ela não está em lugar nenhum do campo.
 *
 * O modelo não inventou: traduziu a única entrada que tinha. A janela tinha **53 eventos, 39
 * classificados como intenção, e os 39 eram `Bash: <descrição>`** — zero `type='decision'`. Dos 50
 * eventos `Bash:`, o filtro `CMD_DIAGNOSTICO` pegava 11; 28 escapavam só porque o verbo estava em
 * inglês, e 11 porque descreviam MUTAÇÃO, que nenhuma lista de verbos pega:
 * `Bash: Add the anonymous-API block to the Caddyfile` parece intenção.
 *
 * E o prompt fechava o circuito: o cabeçalho anuncia esses eventos como *"eventos de INTENÇÃO —
 * decisões, aprendizados e conclusões"*, e a regra `PROIBIDO` lista seis campos **sem incluir
 * `recentDecisions`**. O único campo sem proibição foi o único que se encheu de log de comando.
 *
 * A saída não é ponderar melhor: é parar de perguntar. Mesma família do `id` que deixou de vir do
 * LLM e do objetivo ancorado na meta — **o que tem dono determinístico não se pede a quem
 * redige**. O dono existe desde 18/09: `registrarDecisaoDeclarada()` grava `type: 'decision'` com
 * o texto original quando a PESSOA declara uma decisão no chat, no Telegram ou no HUB.
 */

type EventoDecisao = { content: string; ts: Date }

const servicoCom = (eventos: EventoDecisao[], espiao?: { where?: unknown; take?: number }) => {
  const prisma = {
    event: {
      findMany: async (args: { where?: unknown; take?: number }) => {
        if (espiao) { espiao.where = args.where; espiao.take = args.take }
        return eventos
      },
    },
  }
  return new ProjectStateService(
    prisma as never, { get: () => undefined } as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  )
}

const lerDecisoes = (svc: ProjectStateService, projectId = 'p1') =>
  (svc as unknown as { decisoesRegistradas: (id: string) => Promise<string[]> })
    .decisoesRegistradas(projectId)

describe('recentDecisions vem do REGISTRO, não do redator', () => {
  it('lê os eventos `type: decision` do projeto', async () => {
    const espiao: { where?: unknown; take?: number } = {}
    await lerDecisoes(servicoCom([], espiao))

    expect(espiao.where).toMatchObject({ projectId: 'p1', type: 'decision' })
    expect(espiao.take).toBe(5)
  })

  /**
   * Reescrever a frase de quem decidiu é a porta por onde o fato inventado entra — foi assim que
   * "Recarregar o serviço Caddy" nasceu de `Bash: Reload Caddy`.
   */
  it('devolve o texto ORIGINAL, nunca uma reformulação', async () => {
    const svc = servicoCom([
      { content: 'decidimos fechar por sessão, não por caminho', ts: new Date('2026-09-19T12:00:00Z') },
    ])

    const [linha] = await lerDecisoes(svc)
    expect(linha).toContain('decidimos fechar por sessão, não por caminho')
  })

  /**
   * "Recente" sem marco é a mesma armadilha do `updatedAt` como sinal de idade: uma decisão de
   * três meses atrás se apresentaria como se fosse de hoje.
   */
  it('carrega a data da decisão', async () => {
    const svc = servicoCom([
      { content: 'optamos por Postgres', ts: new Date('2026-07-02T09:30:00Z') },
    ])

    const [linha] = await lerDecisoes(svc)
    expect(linha.startsWith('[2026-07-02]')).toBe(true)
  })

  /** Projeto sem decisão declarada devolve vazio — honesto, em vez de preenchido com execução. */
  it('sem decisão registrada, o campo fica VAZIO', async () => {
    expect(await lerDecisoes(servicoCom([]))).toEqual([])
  })

  /** Falha de leitura não pode derrubar a síntese inteira nem virar "não há decisões". */
  it('erro de banco não lança', async () => {
    const prisma = { event: { findMany: async () => { throw new Error('banco fora') } } }
    const svc = new ProjectStateService(
      prisma as never, { get: () => undefined } as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )
    await expect(lerDecisoes(svc)).resolves.toEqual([])
  })
})

/**
 * ── O que o LLM devolver neste campo é descartado ───────────────────────────
 *
 * Asserções sobre o TEXTO da fonte, como `identidade-unica.spec.ts` e `memory-ranking.spec.ts`
 * fazem: o caminho que grava é assíncrono e cheio de colaboradores, e montá-lo inteiro aqui
 * mediria os dublês, não a regra.
 */
describe('o campo deixou de ser pedido ao modelo', () => {
  const fonte = readFileSync(join(__dirname, '..', 'project-state.service.ts'), 'utf8')

  it('o schema JSON pedido ao LLM não tem mais `recentDecisions`', () => {
    const schema = fonte.slice(
      fonte.indexOf('Retorne APENAS JSON válido'),
      fonte.indexOf('"definitionOfDone"'),
    )
    expect(schema).not.toMatch(/"recentDecisions"/)
    // O resto do schema continua de pé — o corte foi cirúrgico, não uma poda.
    expect(schema).toMatch(/"objective"/)
    expect(schema).toMatch(/"backlog"/)
  })

  it('o refresh grava a fonte determinística, não o que o modelo devolveu', () => {
    expect(fonte).toMatch(/recentDecisions:\s*decisoesFinais as object/)
    expect(fonte).not.toMatch(/recentDecisions:\s*derived\.recentDecisions/)
  })

  /**
   * As decisões continuam ENTRANDO no prompt: são contexto legítimo para derivar objetivo e
   * backlog. O que saiu foi a saída — e o rótulo avisa o modelo de que aquilo não é dele.
   */
  it('mas continuam entrando como contexto, rotuladas como registro', () => {
    expect(fonte).toMatch(/Decisões recentes atuais \(vêm do REGISTRO, não suas/)
  })
})
