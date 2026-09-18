export type WorkMode = 'implementation' | 'debugging' | 'architecture' | 'study' | 'review'

/**
 * Ordem de preferência por modo. **Espelha** `RANKING_POR_MODO.classes` em
 * `apps/api-v2/src/memory/memory-ranking.const.ts`, que é o canônico.
 *
 * Duplicado de propósito: `@rayzen/types` não é compilado, então importar valor
 * de lá derruba o container em runtime. O que impede o drift é o teste
 * `memory-ranking.spec.ts` da api-v2, que lê este arquivo e falha se divergir —
 * as duas listas já discordaram em três dos cinco modos antes dele existir.
 */
const PRIORIDADE_POR_MODO: Record<WorkMode, readonly string[]> = {
  implementation: ['working', 'consolidated', 'inbox'],
  debugging:      ['working', 'consolidated', 'inbox'],
  architecture:   ['consolidated', 'working', 'inbox'],
  study:          ['consolidated', 'inbox', 'working'],
  review:         ['consolidated', 'working', 'inbox'],
}

export interface WorkModeConfig {
  label: string
  systemPromptSuffix: string
  synthesisFocus: string
  readonly memoryClassPriority: readonly string[]
}

const CONFIGS_BASE: Record<WorkMode, Omit<WorkModeConfig, 'memoryClassPriority'>> = {
  implementation: {
    label: 'Implementação',
    systemPromptSuffix: `
Modo: Implementação.
Foque em: commits recentes, arquivos alterados, blockers técnicos e próximos passos concretos.
Seja direto sobre o que está funcionando, o que está quebrando e qual o próximo passo de código.
Não teorize — mostre soluções práticas.`,
    synthesisFocus: 'commits, arquivos alterados, blockers, plano de implementação e próximos passos técnicos',
  },

  debugging: {
    label: 'Debugging',
    systemPromptSuffix: `
Modo: Debugging.
Foque em: erros específicos, stack traces, tentativas anteriores e o que foi descartado.
Ajude a isolar a causa raiz. Sugira hipóteses concretas e como testá-las.
Não mude de assunto — mantenha foco no problema até resolver.`,
    synthesisFocus: 'erros encontrados, tentativas de solução, o que foi descartado, o que resolveu e próximo passo de investigação',
  },

  architecture: {
    label: 'Arquitetura',
    systemPromptSuffix: `
Modo: Arquitetura.
Foque em: decisões técnicas, trade-offs, estrutura do sistema e impacto de mudanças.
Apresente alternativas com prós/contras concretos. Conecte a decisão atual com decisões anteriores.
Evite implementação prematura — primeiro valide o design.`,
    synthesisFocus: 'decisões técnicas, trade-offs avaliados, estrutura definida e lacunas de documentação',
  },

  study: {
    label: 'Estudo',
    systemPromptSuffix: `
Modo: Estudo.
Foque em: conceitos, comparações, referências e resumos acionáveis.
Explique com exemplos concretos. Conecte o novo conhecimento com o que já foi registrado na memória.
Destaque o que é mais importante lembrar.`,
    synthesisFocus: 'conceitos aprendidos, comparações feitas, referências importantes e insights para reter',
  },

  review: {
    label: 'Revisão',
    systemPromptSuffix: `
Modo: Revisão.
Foque em: o que mudou desde o último estado, o que divergiu dos objetivos e qualidade atual.
Seja crítico mas construtivo. Aponte inconsistências entre o que foi planejado e o que foi feito.
Sugira ajustes de rota.`,
    synthesisFocus: 'o que avançou, o que divergiu dos objetivos, inconsistências identificadas e ajustes sugeridos',
  },
}

const comRanking = (modo: WorkMode): WorkModeConfig => ({
  ...CONFIGS_BASE[modo],
  memoryClassPriority: PRIORIDADE_POR_MODO[modo],
})

// Explícito em vez de `Object.fromEntries`: assim o compilador cobra modo novo
// nos dois lados em vez de aceitar um Record com chaves de tipo perdido.
export const WORK_MODE_CONFIGS: Record<WorkMode, WorkModeConfig> = {
  implementation: comRanking('implementation'),
  debugging:      comRanking('debugging'),
  architecture:   comRanking('architecture'),
  study:          comRanking('study'),
  review:         comRanking('review'),
}

export function getWorkModeConfig(mode?: string | null): WorkModeConfig | null {
  if (!mode) return null
  return WORK_MODE_CONFIGS[mode as WorkMode] ?? null
}
