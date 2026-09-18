import { readFileSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'

/**
 * ── O sensor do erro que derrubou a API em 14/09 ─────────────────────────────
 *
 * Pôr uma rota do Telegram no `InfraHealthController` exigia `HealthModule → TelegramModule`.
 * O `ProjectStateModule` já importava o `HealthModule`, então o grafo fechou:
 *
 *     AppModule → OrchestratorModule → MemoryModule → EventModule → SynthesisModule →
 *     DocumentationModule → ProjectStateModule → HealthModule → TelegramModule →
 *     ProjectStateModule …
 *
 * O Nest não sobe, o container entra em `Restarting`, e a **produção ficou fora do ar**.
 *
 * O que torna isso perigoso é o que NÃO acusou: `tsc --noEmit` passou limpo e as 578 asserções
 * passaram. Dependência circular de MÓDULO não é erro de tipo, e nenhum teste unitário monta o
 * grafo inteiro — cada spec injeta seus próprios dublês. O defeito só aparece no boot.
 *
 * Este check lê os `*.module.ts` como TEXTO e percorre o grafo de `imports`. É a mesma técnica
 * dos anti-drift desta casa (`memory-ranking.spec.ts`, `event-derived-text.spec.ts`), e pelo
 * mesmo motivo: o que precisa ser verificado está na estrutura do arquivo, não no comportamento
 * de uma função.
 *
 * `forwardRef(() => X)` é ciclo **declarado e resolvido** — o Nest o suporta de propósito, então
 * é ignorado aqui. O que este teste caça é o ciclo que ninguém viu.
 *
 * ── Divisão de trabalho com `aplicacao-sobe.spec.ts` ─────────────────────────
 *
 * Aquele sobe o `AppModule` de verdade (`preview: true`) e é a **autoridade**: pergunta ao próprio
 * Nest em vez de deduzir. Este continua existindo por duas razões concretas, não por conforto:
 *
 * 1. **É instantâneo e imprime o ciclo inteiro** (`A → B → C → A`). O outro compila `src` inteiro
 *    e devolve a mensagem do Nest, que nomeia o módulo e o escopo, não a volta completa.
 * 2. **Enxerga módulo que ninguém importou ainda.** O boot só percorre o que pende do `AppModule`;
 *    um módulo construído e ainda não plugado pode nascer com ciclo e só explodir no dia em que
 *    for ligado — que é o dia errado para descobrir.
 *
 * A recíproca também vale, e está anotada lá: o regex daqui já errou uma vez.
 */

const RAIZ = join(__dirname, '..')

function arquivosDeModulo(dir: string): string[] {
  const achados: string[] = []
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada)
    if (statSync(caminho).isDirectory()) {
      if (entrada === 'node_modules' || entrada === '__tests__' || entrada === 'dist') continue
      achados.push(...arquivosDeModulo(caminho))
    } else if (entrada.endsWith('.module.ts')) {
      achados.push(caminho)
    }
  }
  return achados
}

/** Nome da classe declarada no arquivo (`export class XModule`). */
function nomeDoModulo(fonte: string, caminho: string): string {
  return /export class (\w+)/.exec(fonte)?.[1] ?? basename(caminho)
}

/**
 * Módulos citados no array `imports: [...]` do decorator.
 *
 * `forwardRef(...)` é removido ANTES da extração: aquele ciclo é intencional e o Nest o resolve.
 */
function importados(fonte: string): string[] {
  const bloco = /imports:\s*\[([\s\S]*?)\]/.exec(fonte)?.[1] ?? ''
  // O `)` de fechamento da arrow function vem ANTES do `)` do forwardRef, então um
  // não-guloso genérico (`\([\s\S]*?\)`) corta cedo e deixa o nome do módulo para trás —
  // era o que fazia este próprio detector reportar ciclo onde havia forwardRef.
  const semForwardRef = bloco.replace(/forwardRef\s*\(\s*\(\)\s*=>\s*\w+\s*\)/g, '')
  return [...semForwardRef.matchAll(/\b(\w+Module)\b/g)].map((m) => m[1])
}

function construirGrafo(): Map<string, string[]> {
  const grafo = new Map<string, string[]>()
  for (const caminho of arquivosDeModulo(RAIZ)) {
    const fonte = readFileSync(caminho, 'utf8')
    grafo.set(nomeDoModulo(fonte, caminho), importados(fonte))
  }
  return grafo
}

/** DFS com pilha: devolve o primeiro ciclo encontrado, já formatado. */
function acharCiclo(grafo: Map<string, string[]>): string[] | null {
  const EM_VISITA = 1, PRONTO = 2
  const estado = new Map<string, number>()
  const pilha: string[] = []

  function visitar(no: string): string[] | null {
    if (estado.get(no) === PRONTO) return null
    if (estado.get(no) === EM_VISITA) return [...pilha.slice(pilha.indexOf(no)), no]

    estado.set(no, EM_VISITA)
    pilha.push(no)
    for (const vizinho of grafo.get(no) ?? []) {
      if (!grafo.has(vizinho)) continue  // módulo de terceiro (@nestjs/*) — fora do grafo local
      const ciclo = visitar(vizinho)
      if (ciclo) return ciclo
    }
    pilha.pop()
    estado.set(no, PRONTO)
    return null
  }

  for (const no of grafo.keys()) {
    const ciclo = visitar(no)
    if (ciclo) return ciclo
  }
  return null
}

describe('grafo de módulos NestJS — sem ciclo não declarado', () => {
  const grafo = construirGrafo()

  it('encontra os módulos da aplicação', () => {
    expect(grafo.size).toBeGreaterThan(20)
    expect(grafo.has('AppModule')).toBe(true)
  })

  /**
   * A asserção que teria evitado a queda: o ciclo estava no grafo e nada o media.
   */
  it('nenhum ciclo de imports entre módulos', () => {
    const ciclo = acharCiclo(grafo)
    expect(ciclo ? ciclo.join(' → ') : null).toBeNull()
  })

  /**
   * Prova que o detector funciona — sem isto, um bug no próprio percurso deixaria o teste verde
   * para sempre. Sensor que nunca ficou vermelho não foi testado.
   */
  it('o detector pega um ciclo introduzido de propósito', () => {
    const falso = new Map<string, string[]>([
      ['AModule', ['BModule']],
      ['BModule', ['CModule']],
      ['CModule', ['AModule']],
    ])
    expect(acharCiclo(falso)).toEqual(['AModule', 'BModule', 'CModule', 'AModule'])
  })

  it('forwardRef não conta como ciclo — é declarado e o Nest resolve', () => {
    const fonte = 'imports: [forwardRef(() => OutroModule), PrismaModule],'
    expect(importados(fonte)).toEqual(['PrismaModule'])
  })
})
