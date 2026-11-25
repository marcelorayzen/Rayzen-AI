import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { BadRequestException, NotFoundException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common'
import { HubAnexoService, type Extrator } from '../hub-anexo.service'
import {
  MODELO_DE_VISAO, MODELOS_DE_VISAO, PROMPT_DE_VISAO, TETO_BYTES, TETO_TEXTO,
  detectarTipo, limitarTexto, nomeParaExibir,
} from '../hub-anexo.const'

/**
 * HC1 (21/11) — anexos do chat do Hub. O tipo é decidido pelos bytes, o original vai para o volume
 * com nome que ninguém escolhe, e o texto que o modelo verá sai daqui. Imagem só pelo Gemini.
 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60)])
// PDF real, lido pelo pdf-parse de verdade (o exemplo que acompanha a biblioteca).
const PDF_REAL = fs.readFileSync(path.join(path.dirname(require.resolve('pdf-parse/package.json')), 'test', 'data', '01-valid.pdf'))

describe('detectarTipo — pelos bytes, nunca pelo nome', () => {
  it.each([
    ['PDF real', PDF_REAL, 'qualquer.bin', 'application/pdf'],
    ['PNG', PNG, 'foto.png', 'image/png'],
    ['PNG com nome .pdf continua PNG', PNG, 'contrato.pdf', 'image/png'],
    ['JPEG', JPEG, 'x.jpg', 'image/jpeg'],
    ['WebP', WEBP, 'x.webp', 'image/webp'],
    ['texto .md', Buffer.from('# Título\nconteúdo'), 'notas.md', 'text/markdown'],
    ['texto .csv', Buffer.from('a,b\n1,2'), 'dados.CSV', 'text/csv'],
  ])('%s', (_caso, buffer, nome, mime) => {
    expect(detectarTipo(buffer, nome)?.mime).toBe(mime)
  })

  it.each([
    ['executável renomeado para .pdf', EXE, 'contrato.pdf'],
    ['executável renomeado para .txt', EXE, 'leia.txt'],
    ['texto com extensão fora da lista', Buffer.from('echo oi'), 'script.sh'],
    ['UTF-8 inválido em .txt', Buffer.from([0x61, 0xff, 0xfe, 0x62]), 'x.txt'],
    ['sem extensão', Buffer.from('oi'), 'arquivo'],
  ])('recusa: %s', (_caso, buffer, nome) => {
    expect(detectarTipo(buffer, nome)).toBeNull()
  })
})

describe('limites e nome', () => {
  it('texto acima do teto é cortado e marcado', () => {
    const r = limitarTexto('a'.repeat(TETO_TEXTO + 10))
    expect(r).toEqual({ texto: 'a'.repeat(TETO_TEXTO), truncado: true })
    expect(limitarTexto('  curto\r\n ')).toEqual({ texto: 'curto', truncado: false })
  })

  it('nome vira só nome: sem caminho, sem caractere de controle', () => {
    expect(nomeParaExibir('../../etc/passwd')).toBe('passwd')
    expect(nomeParaExibir('C:\\Users\\x\\contrato.pdf')).toBe('contrato.pdf')
    expect(nomeParaExibir('a\u0000b\u001fc.txt')).toBe('abc.txt')
    expect(nomeParaExibir(undefined)).toBe('anexo')
  })
})

describe('HubAnexoService', () => {
  let dir: string
  const envAntes = process.env.HUB_ANEXOS_DIR
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-anexos-'))
    process.env.HUB_ANEXOS_DIR = dir
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    if (envAntes === undefined) delete process.env.HUB_ANEXOS_DIR
    else process.env.HUB_ANEXOS_DIR = envAntes
  })

  function cenario(extrator?: Extrator) {
    const linhas: Array<Record<string, unknown>> = []
    const prisma = {
      hubAnexo: {
        findFirst: jest.fn(({ where }) => Promise.resolve(
          [...linhas].reverse().find((l) => Object.entries(where).every(([k, v]) => l[k] === v)) ?? null)),
        findMany: jest.fn(({ where }) => Promise.resolve(linhas.filter((l) =>
          l.caminho && (l.expiraEm as Date) < where.expiraEm.lt))),
        create: jest.fn(({ data }) => { const l = { ...data }; linhas.push(l); return Promise.resolve(l) }),
        update: jest.fn(({ where, data }) => { const l = linhas.find((x) => x.id === where.id)!; Object.assign(l, data); return Promise.resolve(l) }),
      },
    }
    return { svc: new HubAnexoService(prisma as never, extrator), prisma, linhas }
  }

  it('PDF real: texto pelo pdf-parse, original no volume com nome uuid, caminho nunca exposto', async () => {
    const { svc, linhas } = cenario()
    const r = await svc.receber({ principalId: 'humano:1', nome: '../segredo/trace.pdf', buffer: PDF_REAL })

    // Um artigo de 1 MB passa do teto: o texto é cortado e o anexo diz isso.
    expect(r).toMatchObject({ nome: 'trace.pdf', mime: 'application/pdf', extraidoPor: 'pdf-parse', truncado: true, caracteres: TETO_TEXTO })
    expect(r.previa).toContain('Trace-based Just-in-Time')
    expect(JSON.stringify(r)).not.toContain(dir.replace(/\\/g, '\\\\'))
    const gravado = linhas[0].caminho as string
    expect(path.dirname(gravado)).toBe(path.resolve(dir))
    expect(path.basename(gravado)).toMatch(/^[0-9a-f-]{36}$/)
    expect(fs.readFileSync(gravado).equals(PDF_REAL)).toBe(true)
    expect((linhas[0].expiraEm as Date).getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000)
  })

  it('o mesmo arquivo da mesma pessoa não é extraído nem gravado duas vezes', async () => {
    const extrator = jest.fn().mockResolvedValue({ texto: 'oi', extraidoPor: 'utf8' })
    const { svc, prisma } = cenario(extrator)
    const a = await svc.receber({ principalId: 'humano:1', nome: 'a.txt', buffer: Buffer.from('oi') })
    const b = await svc.receber({ principalId: 'humano:1', nome: 'b.txt', buffer: Buffer.from('oi') })
    expect(b.id).toBe(a.id)
    expect(extrator).toHaveBeenCalledTimes(1)
    expect(prisma.hubAnexo.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['vazio', Buffer.alloc(0), 'a.txt', BadRequestException],
    ['acima de 10 MB', Buffer.alloc(TETO_BYTES + 1, 0x61), 'a.txt', PayloadTooLargeException],
    ['tipo fora da lista', EXE, 'contrato.pdf', BadRequestException],
  ])('recusa %s sem gravar nada', async (_caso, buffer, nome, erro) => {
    const { svc, prisma } = cenario()
    await expect(svc.receber({ principalId: 'humano:1', nome, buffer })).rejects.toBeInstanceOf(erro)
    expect(prisma.hubAnexo.create).not.toHaveBeenCalled()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('imagem vai para o Gemini com a instrução fixa, e a descrição é o texto', async () => {
    const { svc } = cenario()
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'Print de tela com o texto: pagar boleto' } }], usage: { total_tokens: 90 } })
    Object.assign(svc, { llm: { chat: { completions: { create } } } })

    const r = await svc.receber({ principalId: 'humano:1', nome: 'print.png', buffer: PNG })

    expect(r).toMatchObject({ mime: 'image/png', extraidoPor: `visao:${MODELO_DE_VISAO}`, previa: 'Print de tela com o texto: pagar boleto' })
    const pedido = create.mock.calls[0][0]
    expect(pedido.model).toBe(MODELO_DE_VISAO)
    expect(pedido.messages[0]).toEqual({ role: 'system', content: PROMPT_DE_VISAO })
    expect(pedido.messages[1].content[0].image_url.url).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
  })

  it('Gemini fora do ar nos dois modelos: 503 (não 502, que o Cloudflare troca) e nada gravado', async () => {
    const { svc, prisma } = cenario()
    const create = jest.fn().mockRejectedValue(new Error('429'))
    Object.assign(svc, { llm: { chat: { completions: { create } } } })
    await expect(svc.receber({ principalId: 'humano:1', nome: 'x.png', buffer: PNG })).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(create.mock.calls.map((c) => c[0].model)).toEqual([...MODELOS_DE_VISAO])
    expect(prisma.hubAnexo.create).not.toHaveBeenCalled()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('principal sem cota: a reserva lê a imagem, e o anexo diz quem leu (HC6, 23/11)', async () => {
    const { svc } = cenario()
    const create = jest.fn()
      .mockRejectedValueOnce(new Error('429 You exceeded your current quota'))
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Folha impressa com o título Apostila' } }], usage: { total_tokens: 70 } })
    Object.assign(svc, { llm: { chat: { completions: { create } } } })
    const r = await svc.receber({ principalId: 'humano:1', nome: 'foto.jpg', buffer: PNG })
    expect(create.mock.calls.map((c) => c[0].model)).toEqual([MODELO_DE_VISAO, MODELOS_DE_VISAO[1]])
    expect(r).toMatchObject({ extraidoPor: `visao:${MODELOS_DE_VISAO[1]}`, previa: 'Folha impressa com o título Apostila' })
  })

  it('anexo de outra pessoa é 404', async () => {
    const { svc } = cenario(jest.fn().mockResolvedValue({ texto: 'oi', extraidoPor: 'utf8' }))
    const a = await svc.receber({ principalId: 'humano:1', nome: 'a.txt', buffer: Buffer.from('oi') })
    await expect(svc.buscar('humano:2', a.id)).rejects.toBeInstanceOf(NotFoundException)
    expect((await svc.buscar('humano:1', a.id)).texto).toBe('oi')
  })

  it('original vencido é apagado do disco; o texto fica', async () => {
    const { svc, linhas } = cenario(jest.fn().mockResolvedValue({ texto: 'conteúdo', extraidoPor: 'utf8' }))
    await svc.receber({ principalId: 'humano:1', nome: 'a.txt', buffer: Buffer.from('conteúdo') })
    const gravado = linhas[0].caminho as string

    expect(await svc.limparExpirados(new Date(Date.now() + 31 * 24 * 3600 * 1000))).toBe(1)
    expect(fs.existsSync(gravado)).toBe(false)
    expect(linhas[0]).toMatchObject({ caminho: null, texto: 'conteúdo' })
  })
})
