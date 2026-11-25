import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * O bloco de invariantes injetado pelo hook.
 *
 * O hook é .mjs sem exports (roda como script), então a função é extraída do
 * fonte e avaliada — mesmo padrão de outros testes de hook deste repo. O que
 * importa travar aqui é o comportamento que decide se o aviso ajuda ou vira
 * ruído: silêncio quando está tudo ok, e as falhas graves primeiro quando não está.
 */
function carregarFormatador(): (r: unknown) => string | null {
  const src = readFileSync(
    join(__dirname, '..', 'hooks', 'rayzen-context-hook.mjs'),
    'utf8',
  )
  const inicio = src.indexOf('function formatInvariantsSection')
  if (inicio === -1) throw new Error('formatInvariantsSection não encontrada no hook')
  // Vai até a próxima declaração de função no topo do arquivo.
  const resto = src.slice(inicio)
  const fim   = resto.indexOf('\n// ──', 1)
  const corpo = fim === -1 ? resto : resto.slice(0, fim)

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${corpo}; return formatInvariantsSection`)() as (r: unknown) => string | null
}

describe('hook — bloco de invariantes', () => {
  const format = carregarFormatador()

  const falha = (over: Record<string, unknown> = {}) => ({
    id: 'x', titulo: 'Título', categoria: 'dado', gravidade: 'media',
    ok: false, detalhe: 'detalhe medido', ...over,
  })

  it('fica em silêncio quando está tudo ok', () => {
    // Um bloco "8 de 8 ok" em todo prompt treinaria a ignorar o aviso que importa.
    expect(format({ totalOk: 8, totalFalha: 0, gravidadeMax: 'ok', resultados: [
      { id: 'a', titulo: 'A', gravidade: 'alta', ok: true, detalhe: 'ok' },
    ] })).toBeNull()
  })

  it('sem cache não injeta nada', () => {
    expect(format(null)).toBeNull()
  })

  it('mostra a falha com gravidade, título e o que foi medido', () => {
    const out = format({
      totalOk: 7, totalFalha: 1, gravidadeMax: 'alta',
      resultados: [falha({ gravidade: 'alta', titulo: 'Relógio bate com a realidade', detalhe: 'Servidor 115 dias fora do horário real' })],
    })!

    expect(out).toContain('Invariantes quebrados (1 de 8)')
    expect(out).toContain('[alta] Relógio bate com a realidade')
    expect(out).toContain('115 dias')
  })

  it('inclui a correção quando existe', () => {
    const out = format({
      totalOk: 0, totalFalha: 1, gravidadeMax: 'alta',
      resultados: [falha({ correcao: 'sudo timedatectl set-ntp true' })],
    })!

    expect(out).toContain('sudo timedatectl set-ntp true')
  })

  it('ordena por gravidade — alta primeiro', () => {
    const out = format({
      totalOk: 0, totalFalha: 3, gravidadeMax: 'alta',
      resultados: [
        falha({ gravidade: 'baixa', titulo: 'BAIXA' }),
        falha({ gravidade: 'alta',  titulo: 'ALTA' }),
        falha({ gravidade: 'media', titulo: 'MEDIA' }),
      ],
    })!

    expect(out.indexOf('ALTA')).toBeLessThan(out.indexOf('MEDIA'))
    expect(out.indexOf('MEDIA')).toBeLessThan(out.indexOf('BAIXA'))
  })

  it('trunca em 4 falhas para não dominar o contexto', () => {
    const out = format({
      totalOk: 0, totalFalha: 6, gravidadeMax: 'media',
      resultados: Array.from({ length: 6 }, (_, i) => falha({ titulo: `F${i}` })),
    })!

    expect(out).toContain('+2')
    expect(out).not.toContain('F5')
  })
})

describe('hook — idade do relatório', () => {
  const format = carregarFormatador()
  const falha = { id: 'x', titulo: 'T', categoria: 'dado', gravidade: 'alta', ok: false, detalhe: 'd' }

  it('mostra há quantos minutos foi medido', () => {
    // Estado sem data é indistinguível de estado atual. Aconteceu em 2026-08-13:
    // logo após a correção, o bloco ainda acusava a falha já resolvida e não havia
    // como saber disso lendo o aviso.
    const out = format({ totalOk: 7, totalFalha: 1, gravidadeMax: 'alta', resultados: [falha], _idadeMin: 25 })!
    expect(out).toContain('medido há 25min')
  })

  it('diz "agora" quando acabou de rodar', () => {
    const out = format({ totalOk: 7, totalFalha: 1, gravidadeMax: 'alta', resultados: [falha], _idadeMin: 0 })!
    expect(out).toContain('· agora')
  })

  it('omite a idade quando o cache não a traz (formato antigo)', () => {
    const out = format({ totalOk: 7, totalFalha: 1, gravidadeMax: 'alta', resultados: [falha] })!
    expect(out).not.toContain('medido há')
  })
})
