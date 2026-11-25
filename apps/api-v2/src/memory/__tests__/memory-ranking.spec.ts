import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { boostDoModo, RANKING_POR_MODO, PESO_POR_POSICAO } from '../memory-ranking.const'

/**
 * Mora aqui, e não em `packages/types`, porque o pacote não tem runner próprio —
 * o `pnpm test` do monorepo roda por app. Teste que não executa é pior que
 * nenhum: dá a mesma sensação de cobertura sem nenhuma garantia.
 */

/**
 * Havia duas fontes de verdade sobre como o modo inclina a busca:
 * `memoryClassPriority` no `work-modes.ts` da V1 e `MODE_CLASS_BOOST` na V2.
 * Medido em 2026-08-16: **três dos cinco modos discordavam** — em
 * `implementation` a V1 punha `consolidated` em primeiro e a V2 dava peso zero.
 */
describe('boostDoModo', () => {
  it('arquitetura prioriza decisão acima de tudo', () => {
    const decisao = boostDoModo('architecture', 'consolidated', 'decision')
    const licao   = boostDoModo('architecture', 'consolidated', 'lesson')

    expect(decisao).toBeGreaterThan(licao)
  })

  it('debugging prioriza lição, não decisão', () => {
    // Depurando, o que serve é o que já quebrou antes — não o registro de por que
    // a arquitetura é como é.
    expect(boostDoModo('debugging', 'working', 'lesson'))
      .toBeGreaterThan(boostDoModo('debugging', 'working', 'decision'))
  })

  it('modo livre (ausente) não aplica viés nenhum', () => {
    // Ausência deliberada de preferência, não um modo com regras próprias.
    expect(boostDoModo(null, 'consolidated', 'decision')).toBe(0)
    expect(boostDoModo(undefined, 'consolidated', 'decision')).toBe(0)
    expect(boostDoModo('modo-inexistente', 'consolidated', 'decision')).toBe(0)
  })

  it('o boost inclina o ranking, nunca o substitui', () => {
    // O score é similaridade de cosseno; numa busca real os três primeiros vieram
    // 0.638 · 0.610 · 0.565 — espaçamento de ~0,07. O boost anterior era +0.20,
    // quase 3x isso: um documento a 0,45 passava na frente de um a 0,63.
    const ESPACAMENTO_TIPICO = 0.07
    const maximo = Math.max(
      ...(Object.keys(RANKING_POR_MODO) as Array<keyof typeof RANKING_POR_MODO>).map((modo) =>
        boostDoModo(modo, RANKING_POR_MODO[modo].classes[0], RANKING_POR_MODO[modo].tipos[0]),
      ),
    )

    expect(maximo).toBeLessThan(ESPACAMENTO_TIPICO)
  })

  it('classe fora da ordem do modo não ganha nada', () => {
    // `archive` não aparece na preferência de nenhum modo.
    expect(boostDoModo('architecture', 'archive', null)).toBe(0)
  })

  it('classe e tipo somam, e a soma respeita a posição', () => {
    const primeiro = boostDoModo('architecture', 'consolidated', 'decision')
    expect(primeiro).toBeCloseTo(PESO_POR_POSICAO[0] * 2, 6)

    const segundo = boostDoModo('architecture', 'working', 'constraint')
    expect(segundo).toBeCloseTo(PESO_POR_POSICAO[1] * 2, 6)
    expect(primeiro).toBeGreaterThan(segundo)
  })

  it('todo modo declara classes e tipos — sem preferência implícita', () => {
    for (const [modo, r] of Object.entries(RANKING_POR_MODO)) {
      expect(r.classes.length).toBeGreaterThan(0)
      expect(r.tipos.length).toBeGreaterThan(0)
      // Duplicata na ordem tornaria a posição ambígua.
      expect(new Set(r.classes).size).toBe(r.classes.length)
      expect(new Set(r.tipos).size).toBe(r.tipos.length)
      expect(modo).toBeTruthy()
    }
  })
})

/**
 * Anti-drift: a V1 declara a mesma ordem de classes no seu `work-modes.ts`,
 * porque `@rayzen/types` nao e compilado e importar valor de la derruba o
 * container. Duplicacao consciente, com o drift barrado aqui.
 *
 * Le o arquivo como TEXTO de proposito — importar codigo da V1 dentro da suite
 * da V2 criaria acoplamento entre os dois apps so para satisfazer um teste.
 */
describe('anti-drift: V1 work-modes.ts espelha o canonico', () => {
  const V1 = resolve(__dirname, '../../../../api/src/modules/orchestrator/work-modes.ts')

  it('o arquivo da V1 existe onde o teste espera', () => {
    // Se alguem mover o arquivo, este teste falha em vez de passar vazio —
    // teste que nao encontra o alvo e pior que teste ausente.
    expect(existsSync(V1)).toBe(true)
  })

  it('a ordem de classes bate modo a modo', () => {
    const texto = readFileSync(V1, 'utf8')
    const bloco = /PRIORIDADE_POR_MODO[^=]*=\s*\{([\s\S]*?)\n\}/.exec(texto)
    expect(bloco).not.toBeNull()

    const declarado: Record<string, string[]> = {}
    for (const m of bloco![1].matchAll(/(\w+):\s*\[([^\]]+)\]/g)) {
      declarado[m[1]] = m[2].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean)
    }

    expect(Object.keys(declarado).sort()).toEqual(Object.keys(RANKING_POR_MODO).sort())
    for (const [modo, r] of Object.entries(RANKING_POR_MODO)) {
      expect(declarado[modo]).toEqual(r.classes)
    }
  })

  /**
   * O boost inclina **conhecimento curado**, e isso é escopo declarado.
   *
   * Medido em 2026-08-18: 97,4% do acervo não tem etiqueta (45 de 1.715 no Rayzen AI)
   * e **nenhum documento de arquivo tem** — nem poderia, porque `decision`, `lesson`,
   * `pattern` e `constraint` descrevem conhecimento curado, não um `page.tsx`.
   *
   * O que não pode acontecer é o sem-etiqueta ganhar peso por engano. A busca passava
   * `memoryClass ?? 'inbox'`, e como `inbox` faz parte das listas de preferência o
   * não-classificado herdava a posição dele.
   */
  describe('escopo: sem etiqueta não recebe boost', () => {
    it('classe e tipo nulos devolvem zero em todos os modos', () => {
      for (const modo of Object.keys(RANKING_POR_MODO)) {
        expect(boostDoModo(modo, null, null)).toBe(0)
      }
    })

    /**
     * O caso concreto que motivou a mudança: em `study`, `inbox` é o SEGUNDO da lista
     * de classes, valendo +0.015 — mais que os +0.005 do `working`. Tratar
     * não-classificado como `inbox` fazia um `pnpm-lock.yaml` vencer uma lição curada.
     */
    it('em study, o não-classificado não vence conhecimento curado', () => {
      const semEtiqueta = boostDoModo('study', null, null)
      const curadoWorking = boostDoModo('study', 'working', null)

      expect(semEtiqueta).toBe(0)
      expect(curadoWorking).toBeGreaterThan(semEtiqueta)
    })

    it('inbox de verdade continua valendo o peso da posição', () => {
      // Documento realmente classificado como inbox não é afetado — o que mudou é só
      // deixar de fingir que ausência de etiqueta é inbox.
      expect(boostDoModo('study', 'inbox', null)).toBeGreaterThan(0)
    })
  })
})
