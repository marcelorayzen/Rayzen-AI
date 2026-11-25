import type { TaskStatus } from '@rayzen/types'
import { EstadoDoHandoff, podeTransicionar } from './handoff.const'

/**
 * Como o ciclo de vida da TAREFA move o envelope.
 *
 * ── Por que isto é uma função, e não um serviço injetado ────────────────────
 * O `HandoffModule` importa o `ExecutionModule`, que importa o `AgentBridgeModule`. Fazer o
 * bridge chamar um `HandoffService` fecharia o grafo, e ciclo de módulo não é erro de tipo:
 * `tsc` passa limpo, os specs unitários passam, e o Nest se recusa a subir — foi o que derrubou
 * a produção em 14/09. Uma função pura mais o `PrismaService` (que é `@Global`) não cria aresta
 * nenhuma no grafo.
 *
 * ── Os sinais são os que existem de verdade ─────────────────────────────────
 * A tarefa expõe `processing` uma vez só, no claim — ela não distingue "peguei" de "estou
 * trabalhando". O que distingue é o **heartbeat**, que só quem está executando manda. Por isso
 * `claimed` vem do claim e `executing` vem do batimento: inventar um sinal para preencher o
 * estado seria dar nome a uma coisa que ninguém observou.
 */
export type SinalDaTarefa =
  | { tipo: 'claim' }
  | { tipo: 'heartbeat' }
  | { tipo: 'status'; status: TaskStatus }

/**
 * `null` quando não há o que fazer — sinal repetido, transição não permitida, envelope já
 * final. Devolver `null` em vez de lançar é deliberado: o ciclo de vida da tarefa não pode
 * falhar porque o envelope já estava onde deveria.
 */
export function proximoEstadoDoHandoff(
  atual: EstadoDoHandoff,
  sinal: SinalDaTarefa,
): EstadoDoHandoff | null {
  const alvo = alvoDoSinal(atual, sinal)
  if (!alvo || alvo === atual) return null
  return podeTransicionar(atual, alvo) ? alvo : null
}

function alvoDoSinal(atual: EstadoDoHandoff, sinal: SinalDaTarefa): EstadoDoHandoff | null {
  if (sinal.tipo === 'claim') return 'claimed'
  if (sinal.tipo === 'heartbeat') return 'executing'

  switch (sinal.status) {
    /**
     * Tarefa `done` NAO conclui o envelope — ela o leva a reconciliacao.
     *
     * O executor dizer que terminou e um relato, nao uma prova: e a mesma distincao que
     * fez esta casa parar de tratar container saudavel como evidencia de deploy. O que
     * fecha o envelope e a verificacao de que o efeito esta LA — pasta no disco, projeto
     * no catalogo —, e ela acontece em `reconciling`.
     */
    case 'done':
      // Vindo de `effect_unknown`, o `done` e a RECONCILIACAO HUMANA dizendo que o efeito
      // foi confirmado — uma pessoa ja olhou. Mandar isso de volta para verificacao faria
      // uma checagem de maquina reabrir a decisao de quem tinha a informacao para decidir.
      return atual === 'effect_unknown' ? 'completed' : 'reconciling'
    // O vocabulário da Fase 1 já separa estes três, e o envelope os repete sem reinterpretar:
    // quem decidiu que o efeito não aconteceu, ou foi compensado, foi a reconciliação.
    case 'failed_safe': return 'failed_safe'
    case 'compensated': return 'compensated'
    case 'effect_unknown': return 'effect_unknown'

    /**
     * `failed` é o único que exige julgamento, e ele sai do estado do PRÓPRIO envelope.
     *
     * A tarefa não diz se houve efeito quando a ação lançou. Chamar tudo de `failed_safe`
     * afirmaria ausência de efeito sem ter olhado — e `failed_safe` é exatamente a afirmação
     * "não aconteceu nada". Chamar tudo de `effect_unknown` mandaria uma pessoa reconciliar
     * até erro de validação, e reconciliação que dispara sempre é a que alguém desliga.
     *
     * O que se sabe de verdade é se a execução chegou a começar: sem batimento nenhum, a ação
     * falhou antes de reportar progresso; com batimento, ela estava no meio do efeito.
     */
    case 'failed': return atual === 'executing' ? 'effect_unknown' : 'failed_safe'

    // `pending`/`processing` não movem nada sozinhos: quem move é o claim e o batimento.
    default: return null
  }
}
