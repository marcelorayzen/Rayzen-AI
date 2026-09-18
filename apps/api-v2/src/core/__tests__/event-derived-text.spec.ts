import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ehTextoDerivadoDeEvento, textoLimpo,
  ECO_ESCRITA, ECO_LEITURA, TELEMETRIA_HOOK, CAMINHO_ARQUIVO, PROSA_DE_ARQUIVO,
  TOKEN_ARQUIVO, ARQUIVOS_ATE_VIRAR_LISTA,
} from '../event-derived-text.const'

/**
 * A regra existe duas vezes de propósito, e o drift é barrado aqui.
 *
 * A V1 limpa na leitura pelo `ProjectStateService.serialize()`; o `V1BridgeService`
 * desta app lê a linha CRUA do Prisma e nunca passa por lá. Sem a cópia, o mesmo
 * ProjectState respondia duas coisas conforme quem perguntava — a V1 devolvia `''`
 * para o objetivo derivado de arquivo do Rayzen Commerce enquanto a V2 o injetava
 * inteiro em todo contexto.
 *
 * Não dá para importar de `packages/types`: o pacote **não é compilado** e importar
 * valor de lá derruba o container. Mesma solução de `memory-ranking`, cujas duas
 * listas já discordaram em três dos cinco modos antes de existir teste.
 */
describe('event-derived-text — cópia V1/V2 não pode divergir', () => {
  const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
  const ORIGEM_V1 = 'apps/api/src/modules/project-state/event-derived-text.const.ts'

  const fonteV1 = readFileSync(join(REPO_ROOT, ORIGEM_V1), 'utf8')

  /** Só o que importa para o comportamento: as declarações, sem comentário. */
  const declaracoes = (fonte: string): string[] =>
    fonte
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^export (const|function)/.test(l) || /^\s*(if|return|const s|const arquivos)/.test(l))

  it('a V1 declara exatamente as mesmas regras', () => {
    const fonteV2 = readFileSync(join(__dirname, '..', 'event-derived-text.const.ts'), 'utf8')

    expect(declaracoes(fonteV2)).toEqual(declaracoes(fonteV1))
  })

  it.each([
    ['ECO_ESCRITA',      ECO_ESCRITA],
    ['ECO_LEITURA',      ECO_LEITURA],
    ['TELEMETRIA_HOOK',  TELEMETRIA_HOOK],
    ['CAMINHO_ARQUIVO',  CAMINHO_ARQUIVO],
    ['PROSA_DE_ARQUIVO', PROSA_DE_ARQUIVO],
    ['TOKEN_ARQUIVO',    TOKEN_ARQUIVO],
  ])('o regex %s é idêntico ao da V1', (nome, regex) => {
    // Compara a FONTE do regex: um `\.?` a menos aqui e dotfile deixa de casar só de
    // um lado, o que é exatamente o tipo de divergência silenciosa que se procura.
    expect(fonteV1).toContain(regex.source)
  })

  it('o limiar de "vira lista de arquivos" é o mesmo', () => {
    expect(fonteV1).toContain(`ARQUIVOS_ATE_VIRAR_LISTA = ${ARQUIVOS_ATE_VIRAR_LISTA}`)
  })
})

describe('event-derived-text — comportamento', () => {
  it.each([
    'Realizar alterações nos arquivos orders.ts, package.json e schema.prisma',
    'Editar o arquivo CLAUDE.md',
    'Edit: c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\CLAUDE.md',
    'Workspace alterado: rayzen-ai [main@85ad502d] — .claude/settings.json',
    'hook-timing',
  ])('rejeita %s', (texto) => {
    expect(ehTextoDerivadoDeEvento(texto)).toBe(true)
    expect(textoLimpo(texto)).toBe('')
  })

  it.each([
    'Rayzen serve um projeto que nao e ele mesmo',
    'Migrar schema.prisma para multi-schema',          // 1 arquivo não condena
    'Corrigir orders.ts e package.json no build',      // 2 também não
    'Entregar a primeira versão funcional da Rayzen Commerce Platform',
  ])('preserva %s', (texto) => {
    expect(ehTextoDerivadoDeEvento(texto)).toBe(false)
    expect(textoLimpo(texto)).toBe(texto)
  })

  it('vazio e não-string não são "derivados de evento"', () => {
    expect(ehTextoDerivadoDeEvento('')).toBe(false)
    expect(ehTextoDerivadoDeEvento(null)).toBe(false)
    expect(textoLimpo(null)).toBe('')
  })

  /**
   * `TOKEN_ARQUIVO` tem flag /g e portanto `lastIndex` mutável. Se alguma chamada usar
   * `.test()` em vez de `.match()`, a segunda invocação começa do meio da string e o
   * resultado passa a depender da anterior.
   */
  it('é idempotente — o regex global não guarda estado entre chamadas', () => {
    const lista = 'orders.ts, package.json, schema.prisma'

    expect(ehTextoDerivadoDeEvento(lista)).toBe(true)
    expect(ehTextoDerivadoDeEvento(lista)).toBe(true)
    expect(ehTextoDerivadoDeEvento(lista)).toBe(true)
  })
})
