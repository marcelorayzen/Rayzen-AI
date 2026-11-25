import { readFileSync } from 'fs'
import { join } from 'path'
import { ALCADA_POR_EFEITO, EXCECOES_ABAIXO_DO_PISO, alcadaDoEfeito, alcadaDoEnvelope } from '../alcada.const'
import { ISOLAMENTO_POR_EFEITO } from '../isolamento-por-efeito.const'

/** Risco canônico, lido do registro da V2 como texto — apps separados, sem import. */
function riscoDoRegistro(): Record<string, string> {
  const fonte = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'api-v2', 'src', 'skill-engine', 'skill-registry.ts'),
    'utf8',
  )
  const r: Record<string, string> = {}
  for (const m of fonte.matchAll(/id:\s*'jarvis:([a-z_]+)'[^\n]*?risk:\s*'([a-z]+)'/g)) r[m[1]] = m[2]
  return r
}

const PISO: Record<string, string[]> = {
  high: ['critico'],
  medium: ['propoe', 'critico'],
  low: ['autonomo', 'propoe', 'critico'],
  none: ['autonomo', 'propoe', 'critico'],
}

describe('alçada por efeito', () => {
  const risco = riscoDoRegistro()

  it('a leitura do registro encontrou as ações de verdade', () => {
    // Sem isto, um formato novo do registro faria o regex casar zero e o piso passaria por vacuidade.
    expect(Object.keys(risco).length).toBeGreaterThan(40)
  })

  it('cobre exatamente as ações despacháveis — nem falta, nem sobra', () => {
    expect(Object.keys(ALCADA_POR_EFEITO).sort()).toEqual(Object.keys(ISOLAMENTO_POR_EFEITO).sort())
  })

  /** A regra inteira: pode ser mais rígida que o risco, nunca mais frouxa. */
  it('nenhuma ação fica abaixo do piso do risco canônico', () => {
    const abaixo = Object.entries(ALCADA_POR_EFEITO)
      .filter(([acao, nivel]) => risco[acao] !== undefined && !PISO[risco[acao]].includes(nivel))
      .filter(([acao]) => !(acao in EXCECOES_ABAIXO_DO_PISO))
      .map(([acao, nivel]) => `${acao}: risco ${risco[acao]}, alçada ${nivel}`)
    expect(abaixo).toEqual([])
  })

  /** A exceção precisa estar de fato abaixo do piso — senão é uma licença esquecida. */
  it('cada exceção nomeada está realmente abaixo do piso, e são só estas', () => {
    expect(Object.keys(EXCECOES_ABAIXO_DO_PISO)).toEqual(['supervised_session'])
    for (const acao of Object.keys(EXCECOES_ABAIXO_DO_PISO)) {
      expect(PISO[risco[acao]]).not.toContain(ALCADA_POR_EFEITO[acao])
    }
  })

  it('toda ação da tabela tem risco declarado no registro', () => {
    expect(Object.keys(ALCADA_POR_EFEITO).filter((a) => risco[a] === undefined)).toEqual([])
  })

  it('texto livre é crítico, embora o registro diga medium', () => {
    expect(alcadaDoEfeito('jarvis:run_command')).toBe('critico')
  })

  it('dado pessoal que volta ao Hub não sai sozinho', () => {
    expect(alcadaDoEfeito('read_emails')).toBe('propoe')
    expect(alcadaDoEfeito('clipboard_read')).toBe('propoe')
  })

  it('desconhecido é crítico, nunca autônomo', () => {
    expect(alcadaDoEfeito('jarvis:acao_que_nao_existe')).toBe('critico')
    expect(alcadaDoEnvelope([])).toBe('critico')
  })

  it('o envelope custa o efeito mais caro', () => {
    expect(alcadaDoEnvelope([{ actionKey: 'open_url' }])).toBe('autonomo')
    expect(alcadaDoEnvelope([{ actionKey: 'open_url' }, { actionKey: 'git_push' }])).toBe('propoe')
    expect(alcadaDoEnvelope([{ actionKey: 'git_push' }, { actionKey: 'file_delete' }])).toBe('critico')
  })
})
