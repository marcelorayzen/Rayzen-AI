import { join } from 'path'
import { validar } from '../validador'

/**
 * Fase 2 — validador próprio. Cada tipo tem um caso que aceita e um que rejeita; o objetivo
 * não é cobertura exaustiva de regex, é garantir que CADA tipo realmente valida (em vez de
 * aceitar qualquer coisa por engano de implementação).
 */
describe('validador — enum', () => {
  const spec = { tipo: 'enum', valores: ['deploy', 'status'] } as const

  it('aceita valor da lista', () => {
    expect(validar(spec, 'deploy', 'mode')).toBe('deploy')
  })

  it('rejeita valor fora da lista', () => {
    expect(() => validar(spec, 'delete-everything', 'mode')).toThrow(/valor inválido/)
  })

  it('rejeita não-string', () => {
    expect(() => validar(spec, 42, 'mode')).toThrow(/valor inválido/)
  })
})

describe('validador — inteiro', () => {
  const spec = { tipo: 'inteiro', min: 1, max: 30 } as const

  it('aceita dentro do intervalo', () => {
    expect(validar(spec, 15, 'limite')).toBe(15)
  })

  it('aceita string numérica (payload JSON pode trazer como string)', () => {
    expect(validar(spec, '10', 'limite')).toBe(10)
  })

  it.each([0, 31, 1.5, NaN, 'abc'])('rejeita fora do intervalo ou não-inteiro: %s', (valor) => {
    expect(() => validar(spec, valor, 'limite')).toThrow(/precisa ser um inteiro/)
  })
})

describe('validador — slug', () => {
  const spec = { tipo: 'slug' } as const

  it('aceita nome simples', () => {
    expect(validar(spec, 'rayzen-ai-api-1', 'container')).toBe('rayzen-ai-api-1')
  })

  it.each([
    ['espaço', 'x y'],
    ['ponto e vírgula', 'x;y'],
    ['encadeamento', 'x && y'],
    ['subexpressão', 'x$(y)'],
    ['barra', 'x/y'],
  ])('rejeita %s', (_nome, valor) => {
    expect(() => validar(spec, valor, 'container')).toThrow(/nome simples/)
  })
})

describe('validador — projectId', () => {
  const spec = { tipo: 'projectId' } as const

  it('aceita UUID válido', () => {
    const uuid = '7690370b-aa1e-4b13-8335-a8a14ad0d859'
    expect(validar(spec, uuid, 'projectId')).toBe(uuid)
  })

  it.each(['não-é-uuid', '7690370b-aa1e-4b13-8335', ''])('rejeita "%s"', (valor) => {
    expect(() => validar(spec, valor, 'projectId')).toThrow(/UUID válido/)
  })
})

describe('validador — caminhoSeguro', () => {
  const spec = { tipo: 'caminhoSeguro' } as const
  const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

  it('aceita caminho dentro de um safe root', () => {
    // `join()`, não `\\` fixo — separador hardcoded quebra no runner Linux do CI, onde
    // `${HOME}\Projects\rayzen-ai` não é reconhecido como caminho aninhado nenhum.
    const dentro = join(HOME, 'Projects', 'rayzen-ai')
    expect(validar(spec, dentro, 'path')).toContain('rayzen-ai')
  })

  it('rejeita caminho fora dos safe roots', () => {
    expect(() => validar(spec, 'C:\\Windows\\System32', 'path')).toThrow(/fora dos diretórios permitidos/)
  })

  it('rejeita valor vazio', () => {
    expect(() => validar(spec, '', 'path')).toThrow(/precisa ser um caminho/)
  })
})

describe('validador — textoCurto', () => {
  const spec = { tipo: 'textoCurto', max: 10 } as const

  it('aceita texto dentro do limite', () => {
    expect(validar(spec, 'abc', 'pattern')).toBe('abc')
  })

  it('rejeita texto acima do limite', () => {
    expect(() => validar(spec, 'x'.repeat(11), 'pattern')).toThrow(/máximo de 10/)
  })

  it('rejeita vazio', () => {
    expect(() => validar(spec, '', 'pattern')).toThrow(/não vazio/)
  })
})
