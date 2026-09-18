/**
 * ── "Está tudo de pé?" numa resposta só ─────────────────────────────────────
 *
 * Pedido de 17/09: o HUB precisa de visão para quando algum serviço cair. Hoje essa pergunta
 * exige **três chamadas em duas apis, com três formatos diferentes**:
 *
 *   GET /infra/health            (V1)  → 7 serviços
 *   GET /v2/system/problemas     (V2)  → 7 ciclos automáticos
 *   GET /v2/invariants/latest/:id (V2) → 18 invariantes, **por projeto**
 *
 * Nenhuma delas responde sozinha, e a terceira exige saber um `projectId` de antemão — o que
 * um painel de saúde não tem por que saber.
 *
 * ── Por que isto vive na V2, e não na V1 ────────────────────────────────────
 *
 * Mesma razão pela qual `notificar-transicao.ts` fala com a API do Telegram direto: **pedir ao
 * serviço caído que anuncie a própria queda não funciona.** A V1 caiu duas vezes neste mês — o
 * ciclo de módulos em 14/09 e o disco em 16/09 — e uma visão servida por ela fica cega
 * exatamente na hora que importa. A V2 é deliberadamente isolada e não depende da V1 para subir.
 *
 * A V1 entra como **um dos serviços medidos**, e é essa a inversão que faz a visão funcionar.
 *
 * ── Três estados, e `desconhecido` nunca aprova ─────────────────────────────
 *
 * A casa já aplica isso nos invariantes (`inconclusivo`) e no `check:local`. Aqui a regra é
 * ainda mais literal: quem olha o HUB quer saber se pode parar de olhar. Responder "ok" sobre
 * o que não foi medido é a única saída pior que não ter painel.
 *
 * `quebrado` vence `incerto`, que vence `ok` — falha real nunca é mascarada por um desconhecido.
 */

export type EstadoBloco  = 'ok' | 'quebrado' | 'desconhecido'
export type EstadoGeral  = 'ok' | 'quebrado' | 'incerto'
export type Gravidade    = 'alta' | 'media' | 'baixa'

export interface ItemQuebrado {
  id:         string
  titulo:     string
  detalhe?:   string
  gravidade?: Gravidade
}

export interface Bloco {
  estado:    EstadoBloco
  ok:        number
  total:     number
  problemas: ItemQuebrado[]
  /** Só quando há algo que NÃO foi medido — nunca preenchido num bloco `ok`. */
  porque?:   string
  /** Idade da leitura, em horas. Só onde a leitura é um registro gravado. */
  idadeH?:   number
}

export interface Panorama {
  geral:       EstadoGeral
  resumo:      string
  servicos:    Bloco
  ciclos:      Bloco
  invariantes: Bloco
  checadoEm:   string
}

/** Formato do `GET /infra/health` da V1 — só o que este módulo consome. */
export interface SaudeV1 {
  ok:       boolean
  services: Record<string, { ok: boolean; error?: string; meta?: Record<string, unknown> }>
}

/**
 * Serviço sondado por este módulo, além dos que a V1 reporta.
 *
 * Nasceu com o HUB (18/09): o `hermes serve` virou a porta de entrada e **não era observado por
 * nada** — o mesmo buraco que o ciclo deste módulo existe para fechar na V1, recriado no mesmo dia
 * por quem estava fechando o original. Construir vigilância e deixar de fora a coisa nova é o modo
 * de falha registrado desta casa.
 */
export interface ServicoExtra {
  id:     string
  titulo: string
  ok:     boolean
  erro?:  string
}

/** O que a sonda da V1 devolve: houve status HTTP, ou nem isso. */
export type RespostaV1 =
  | { tipo: 'respondeu';    corpo: SaudeV1 }
  | { tipo: 'statusRuim';   status: number }
  | { tipo: 'semResposta';  erro: string }

export interface CicloBruto {
  id:        string
  titulo:    string
  estado:    string
  lastError: string | null
}

export interface InvarianteBruto {
  id:         string
  titulo:     string
  ok:         boolean
  gravidade:  string
  detalhe?:   string
}

/** Uma leitura de invariantes por projeto, já com a idade calculada. */
export interface LeituraDeProjeto {
  projectId:  string
  idadeH:     number
  resultados: InvarianteBruto[]
}

const VAZIO: Bloco = { estado: 'ok', ok: 0, total: 0, problemas: [] }

/**
 * ── Serviços ────────────────────────────────────────────────────────────────
 *
 * A distinção é **estrutural: houve status HTTP?** — a mesma de `modelos_llm_respondem`, e pelo
 * mesmo motivo (nunca por texto de erro).
 *
 *  - respondeu → a V1 está viva e o que ela diz sobre os outros 7 vale;
 *  - status ruim ou sem resposta → **isso é problema, não incógnita**: tentamos e não deu. A V1
 *    entra como item quebrado, e o `porque` diz que os outros ficaram sem medição.
 *
 * Chamar o bloco inteiro de `desconhecido` quando a V1 não responde esconderia o achado mais
 * importante que a sonda produziu.
 */
export function blocoDeServicos(resposta: RespostaV1, extras: ServicoExtra[] = []): Bloco {
  // Sondados aqui, então valem mesmo com a V1 muda — que é justamente quando saber do resto
  // importa mais.
  const problemasExtras: ItemQuebrado[] = extras
    .filter((e) => !e.ok)
    .map((e) => ({ id: e.id, titulo: e.titulo, detalhe: e.erro ?? 'sem detalhe', gravidade: 'alta' as Gravidade }))

  if (resposta.tipo !== 'respondeu') {
    const detalhe = resposta.tipo === 'statusRuim'
      ? `respondeu HTTP ${resposta.status}`
      : `não respondeu (${resposta.erro})`
    const problemas = [
      { id: 'api_v1', titulo: 'A API V1 responde', detalhe, gravidade: 'alta' as Gravidade },
      ...problemasExtras,
    ]
    return {
      estado:    'quebrado',
      ok:        extras.length - problemasExtras.length,
      total:     1 + extras.length,
      problemas,
      porque:    'os serviços que só a V1 alcança (postgres, redis, litellm, mcp, agent desktop) ficaram sem medição',
    }
  }

  const entradas  = Object.entries(resposta.corpo.services ?? {})
  const problemas = [
    ...entradas
      .filter(([, s]) => !s.ok)
      .map(([id, s]) => ({
        id,
        titulo:    id,
        detalhe:   s.error ?? 'sem detalhe',
        gravidade: 'alta' as Gravidade,
      })),
    ...problemasExtras,
  ]

  // `api_v1` não vem na lista da V1 (ela não se sonda), mas respondeu — então conta como ok.
  const total = entradas.length + 1 + extras.length
  return {
    estado:    problemas.length ? 'quebrado' : 'ok',
    ok:        total - problemas.length,
    total,
    problemas,
  }
}

/**
 * ── Ciclos automáticos ──────────────────────────────────────────────────────
 *
 * `problemas()` do `SystemStatusService` já decide o que conta como problema (`estado !==
 * 'saudavel'`, então `nunca-subiu` entra). Essa decisão **não se re-litiga aqui** — dois lugares
 * decidindo o mesmo é como um valida contra uma lista e o outro roda contra outra.
 *
 * O que este bloco acrescenta é um caso que `status()` não distingue: ele engole erro do Prisma
 * e devolve `[]`, e como a montagem itera o CATÁLOGO, banco fora do ar vira **"os 7 ciclos nunca
 * subiram"** — 7 falhas inventadas escondendo a única real. Daí `bancoOk` vir de fora.
 */
export function blocoDeCiclos(ciclos: CicloBruto[], bancoOk: boolean): Bloco {
  if (!bancoOk) {
    return {
      estado:    'desconhecido',
      ok:        0,
      total:     0,
      problemas: [],
      porque:    'o banco da V2 não respondeu — o batimento dos ciclos vive lá, e sem ele todo ciclo pareceria parado',
    }
  }

  const problemas = ciclos
    .filter((c) => c.estado !== 'saudavel')
    .map((c) => ({
      id:        c.id,
      titulo:    c.titulo,
      detalhe:   c.lastError ? `${c.estado} — ${c.lastError}` : c.estado,
      gravidade: (c.estado === 'nunca-subiu' ? 'baixa' : 'alta') as Gravidade,
    }))

  return {
    estado:    problemas.length ? 'quebrado' : 'ok',
    ok:        ciclos.length - problemas.length,
    total:     ciclos.length,
    problemas,
  }
}

/**
 * ── Invariantes ─────────────────────────────────────────────────────────────
 *
 * Duas coisas que esta função existe para não deixar passar:
 *
 * **1. A leitura é um registro GRAVADO, e pode estar velho.** O ciclo só grava quando há falha
 * ou quando passa o heartbeat, então o relatório mais novo tem até ~6h. Afirmar saúde atual a
 * partir dele repetiria o erro do `updatedAt` como sinal de idade: uma data atestando um frescor
 * que o conteúdo não tem. Acima do limiar o bloco vira `desconhecido` — não "ok".
 *
 * **2. Gravidade `media` que falha por desenho não pode pintar o painel de vermelho.**
 * `registro_sem_projeto` é `media` e a mesma razão que o mantém fora da notificação de transição
 * vale aqui. Ele aparece na contagem e **não** derruba o estado — vermelho permanente é o que se
 * aprende a ignorar.
 */
export function blocoDeInvariantes(leituras: LeituraDeProjeto[], limiteIdadeH: number): Bloco {
  if (!leituras.length) {
    return {
      estado:    'desconhecido',
      ok:        0,
      total:     0,
      problemas: [],
      porque:    'nenhum relatório de invariantes foi encontrado — o ciclo pode nunca ter rodado, ou o banco não respondeu',
    }
  }

  const frescas = leituras.filter((l) => l.idadeH <= limiteIdadeH)
  const idadeH  = Math.min(...leituras.map((l) => l.idadeH))

  if (!frescas.length) {
    return {
      estado:    'desconhecido',
      ok:        0,
      total:     0,
      problemas: [],
      idadeH:    Number(idadeH.toFixed(1)),
      porque:    `a leitura mais nova tem ${idadeH.toFixed(1)}h e o ciclo grava a cada ${limiteIdadeH}h — o relatório não descreve o agora`,
    }
  }

  // ── Um invariante quebrado em 9 projetos é UMA linha, não nove ────────────
  //
  // A primeira leitura real em produção devolveu `registro_sem_projeto` **nove vezes**, com o
  // texto idêntico — porque o passivo histórico que ele relata é global, não por projeto. Numa
  // tela de celular isso empurra tudo o mais para fora, e é literalmente o modo de falha que esta
  // casa nomeia: repetir o mesmo aviso é como ele deixa de ser lido.
  //
  // O agrupamento é por `id`, e o número de projetos vira sufixo — a informação não se perde,
  // deixa de ocupar nove linhas.
  const porId = new Map<string, { item: ItemQuebrado; projetos: string[] }>()
  let ok = 0
  let total = 0

  for (const leitura of frescas) {
    for (const r of leitura.resultados) {
      total++
      if (r.ok) { ok++; continue }

      const existente = porId.get(r.id)
      if (existente) { existente.projetos.push(leitura.projectId); continue }

      porId.set(r.id, {
        projetos: [leitura.projectId],
        item: {
          id:        r.id,
          titulo:    r.titulo,
          detalhe:   r.detalhe,
          gravidade: (r.gravidade === 'alta' || r.gravidade === 'media' || r.gravidade === 'baixa'
            ? r.gravidade
            : 'baixa') as Gravidade,
        },
      })
    }
  }

  const problemas: ItemQuebrado[] = [...porId.values()].map(({ item, projetos }) => ({
    ...item,
    detalhe: projetos.length > 1
      ? `${item.detalhe ?? ''} · em ${projetos.length} projetos`.trim()
      : `${item.detalhe ?? ''} · projeto ${projetos[0].slice(0, 8)}`.trim(),
  }))

  const derruba = problemas.some((p) => p.gravidade === 'alta')
  return {
    estado:    derruba ? 'quebrado' : 'ok',
    ok,
    total,
    problemas,
    idadeH:    Number(idadeH.toFixed(1)),
  }
}

/** `quebrado` > `incerto` > `ok`. Falha medida nunca é mascarada por um desconhecido. */
export function estadoGeral(blocos: Bloco[]): EstadoGeral {
  if (blocos.some((b) => b.estado === 'quebrado'))     return 'quebrado'
  if (blocos.some((b) => b.estado === 'desconhecido'))  return 'incerto'
  return 'ok'
}

/**
 * Uma linha que se lê no celular sem abrir nada.
 *
 * Diferente do hook e dos invariantes, este painel **fala quando está tudo bem** — de propósito.
 * Lá o silêncio protege o aviso de virar ruído num prompt que sai sempre; aqui alguém abriu a
 * tela justamente para perguntar, e não responder é a falha.
 */
export function resumoDoPanorama(p: Omit<Panorama, 'resumo' | 'geral'>, geral: EstadoGeral): string {
  const blocos = [p.servicos, p.ciclos, p.invariantes]
  const quebrados = blocos.flatMap((b) => b.problemas).filter((x) => x.gravidade === 'alta')

  if (geral === 'ok') {
    return `tudo de pé — ${p.servicos.ok} serviços, ${p.ciclos.ok} ciclos, ${p.invariantes.ok} invariantes`
  }

  const naoMedidos = blocos.filter((b) => b.porque).map((b) => b.porque!)

  if (geral === 'incerto') {
    return `nada quebrado no que deu para medir, mas ${naoMedidos.length} coisa(s) não foram medidas: ${naoMedidos.join('; ')}`
  }

  const lista = quebrados.length
    ? quebrados.map((x) => x.id).join(', ')
    : blocos.flatMap((b) => b.problemas).map((x) => x.id).join(', ')
  const cauda = naoMedidos.length ? ` (e ${naoMedidos.length} não medida(s))` : ''
  return `${quebrados.length || blocos.flatMap((b) => b.problemas).length} problema(s): ${lista}${cauda}`
}

export function montarPanorama(
  servicos: Bloco,
  ciclos: Bloco,
  invariantes: Bloco,
  agora = new Date(),
): Panorama {
  const geral  = estadoGeral([servicos, ciclos, invariantes])
  const parcial = { servicos, ciclos, invariantes, checadoEm: agora.toISOString() }
  return { geral, resumo: resumoDoPanorama(parcial, geral), ...parcial }
}

export const BLOCO_VAZIO = VAZIO
