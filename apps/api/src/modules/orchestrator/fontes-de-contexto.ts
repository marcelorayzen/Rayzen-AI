/**
 * ── "Erro de consulta não vira ausência de conhecimento", agora no chat ──────
 *
 * A regra é desta casa e está escrita desde 14/09 em `project-state.service.ts`:
 *
 *     // H2 / C09 — "erro de consulta não vira ausência de conhecimento".
 *
 * Ela foi aplicada **num lugar só**. O orquestrador — o caminho que responde você no Telegram e
 * na web — fazia o oposto em cinco pontos:
 *
 *     .catch(() => null)                 // estado do projeto
 *     .catch(() => null)                 // meta ativa
 *     .catch(() => [])                   // eventos recentes
 *     .catch(() => [])                   // busca na memória (duas vezes)
 *     } catch { return '' }              // o contexto INTEIRO
 *
 * Um soluço do Postgres fazia o modelo receber um projeto sem estado, sem meta e sem histórico —
 * **indistinguível de um projeto recém-criado**. E o modelo responde ao que vê: quem pergunta
 * "onde eu parei?" recebe uma resposta construída sobre um vazio que não é vazio.
 *
 * É a mesma família de `ehTextoDerivadoDeEvento`: a regra estava escrita e aplicada num lugar só.
 *
 * ── Os três estados, e por que `vazio` não é `falhou` ───────────────────────
 *
 * | estado | significa | o que o modelo deve fazer |
 * |---|---|---|
 * | `ok` | consultou e veio conteúdo | usar |
 * | `vazio` | consultou e não há nada | dizer que não há |
 * | `falhou` | **não conseguiu consultar** | dizer que não conseguiu ler — nunca que não existe |
 *
 * Colapsar `falhou` em `vazio` é exatamente o que produz invenção: o modelo não tem como saber a
 * diferença, e a ausência convida a preencher. O invariante `modelos_llm_respondem` já faz essa
 * distinção ("houve status HTTP?"), e `historico_serve_conversa` também. Aqui é a mesma pergunta
 * feita ao contexto do chat.
 *
 * ── Não é sobre o modelo se comportar bem ───────────────────────────────────
 *
 * O aviso não garante que o modelo obedeça. O que ele garante é que a informação **existe no
 * prompt** — hoje ela não existia em lugar nenhum, então nem o melhor modelo poderia acertar.
 * Testar isto é determinístico: força-se a falha e confere-se o texto entregue.
 */

export type EstadoDaFonte = 'ok' | 'vazio' | 'falhou'

export interface Fonte<T> {
  nome:   string
  estado: EstadoDaFonte
  valor:  T
}

/**
 * Consulta uma fonte sem deixar a falha virar silêncio.
 *
 * `vazio` decide o que conta como "não há nada" para ESTA fonte — uma lista vazia e um `null` são
 * vazios; um objeto sem o campo que importa também pode ser. Quem chama sabe; esta função não.
 */
export async function consultarFonte<T>(
  nome: string,
  consulta: () => Promise<T>,
  padraoEmFalha: T,
  ehVazio: (valor: T) => boolean,
): Promise<Fonte<T>> {
  try {
    const valor = await consulta()
    return { nome, estado: ehVazio(valor) ? 'vazio' : 'ok', valor }
  } catch {
    return { nome, estado: 'falhou', valor: padraoEmFalha }
  }
}

/**
 * Linha de aviso quando alguma fonte não pôde ser lida, ou `''` quando todas responderam.
 *
 * Calado no caminho normal, pelo mesmo motivo dos invariantes: um aviso em toda mensagem treina a
 * ignorar o aviso que importa.
 */
export function avisoDeFontesIndisponiveis(fontes: Array<Fonte<unknown>>): string {
  const falharam = fontes.filter((f) => f.estado === 'falhou').map((f) => f.nome)
  if (falharam.length === 0) return ''

  return `\n\nAVISO DE LEITURA: não foi possível consultar ${falharam.join(', ')} para esta resposta. ` +
    'Isso NÃO quer dizer que não exista — quer dizer que não foi possível ler. Não afirme ausência ' +
    'de estado, meta, decisão ou histórico com base nisso; diga que a consulta falhou e ofereça tentar de novo.'
}

/** Projeto real que ainda não teve estado sintetizado. Silêncio aqui também convida a preencher. */
export const SEM_ESTADO_SINTETIZADO =
  '\n\nEste projeto ainda não tem estado sintetizado (nenhum checkpoint gerou objetivo, fase ou ' +
  'próximos passos). Não descreva objetivo, fase ou andamento como se soubesse — não há registro ainda.'

// Mesmos limiares da V2 (`context-engine.service.ts`), e a duplicação é consciente: são a mesma
// pergunta feita em dois lugares, e números diferentes fariam o mesmo projeto ser "parado" num
// canal e "ativo" no outro. Barrado por teste anti-drift.
export const DIAS_ATE_ESTADO_VELHO = 7
export const DIAS_MINIMOS_PARA_ATRASADO = 2
export const EVENTOS_24H_ATE_ESTADO_ATRASADO = 40

/**
 * Contradição entre o que o estado DIZ e o que o trabalho MOSTRA.
 *
 * O caso que importa não é "o estado é velho" — é **estado velho com trabalho acontecendo agora**:
 * a descrição afirma um objetivo que o trabalho já deixou para trás, e o modelo a serve como
 * verdade presente. A V2 declara isso desde 17/08; o chat da V1 servia a descrição sem idade
 * nenhuma, que é a única seção categórica do contexto sem data.
 *
 * `marco` precisa ser `contentChangedAt`, nunca `updatedAt`: o segundo é marca d'água do refresh e
 * avança em toda escrita — medido no Commerce, um refresh zerou o contador mantendo o objetivo de
 * 24/06, e a data atestava um frescor que o texto não tinha.
 */
export function avisoDeEstadoDesatualizado(
  marco: Date | null | undefined,
  eventosDesdeOMarco: number,
  eventosNasUltimas24h: number,
): string {
  if (!marco) return ''

  const dias = Math.floor((Date.now() - new Date(marco).getTime()) / 86_400_000)

  if (dias >= DIAS_MINIMOS_PARA_ATRASADO && eventosNasUltimas24h >= EVENTOS_24H_ATE_ESTADO_ATRASADO) {
    return `\n\nATENÇÃO: esta descrição está inalterada há ${dias} dias, mas houve ${eventosNasUltimas24h} eventos nas ` +
      'últimas 24h — ela provavelmente está atrasada em relação ao trabalho atual. Não a apresente como o estado de hoje.'
  }

  if (dias >= DIAS_ATE_ESTADO_VELHO) {
    return `\n\nNota: descrição inalterada há ${dias} dias, com ${eventosDesdeOMarco} eventos desde então — ` +
      'projeto provavelmente parado. O estado pode estar certo, mas é antigo.'
  }

  return ''
}
