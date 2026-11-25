import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { HubMemoriaService, caminhoNaMemoria } from '../hub-memoria.service'
import { HubMemoriaController } from '../hub-memoria.controller'

/**
 * HC4b (22/11) — gaveta 1 da memória, a biblioteca. O Hub propõe; só pessoa aprova; guardar
 * substitui o que houver no mesmo caminho ("mudar"); remover apaga TODOS os trechos do documento.
 */
const esperar = () => new Promise((r) => setImmediate(r))

function cenario() {
  const propostas: Array<Record<string, unknown>> = []
  const documentos: Array<{ sourcePath: string; projectId: string }> = [
    { sourcePath: 'hub/anexo/an-1/curso.pdf', projectId: 'p1' },
    { sourcePath: 'docs/velho.md', projectId: 'p1' },
    { sourcePath: 'docs/velho.md', projectId: 'p1' },
    { sourcePath: 'docs/velho.md', projectId: 'outro' },
  ]
  const casa = (where: Record<string, unknown>) => (d: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => d[k] === v)
  const prisma = {
    project: { findUnique: jest.fn(async ({ where }) => (where.id === 'nao-existe' ? null : { id: where.id })) },
    hubAnexo: { findUnique: jest.fn(async ({ where }) => (where.id === 'an-1' ? { id: 'an-1', nome: 'curso.pdf', texto: 'x', truncado: true, caminho: '/c', mime: 'application/pdf' } : null)) },
    document: {
      count: jest.fn(async ({ where }) => documentos.filter(casa(where)).length),
      deleteMany: jest.fn(async ({ where }) => {
        const antes = documentos.length
        for (let i = documentos.length - 1; i >= 0; i--) if (casa(where)(documentos[i])) documentos.splice(i, 1)
        return { count: antes - documentos.length }
      }),
    },
    propostaDeMemoria: {
      findFirst: jest.fn(async ({ where }) => propostas.find(casa(where)) ?? null),
      findUnique: jest.fn(async ({ where }) => propostas.find((p) => p.id === where.id) ?? null),
      findMany: jest.fn(async () => propostas),
      create: jest.fn(async ({ data }) => { const p = { id: `prop-${propostas.length + 1}`, status: 'proposta', ...data }; propostas.push(p); return p }),
      update: jest.fn(async ({ where, data }) => Object.assign(propostas.find((p) => p.id === where.id)!, data)),
      updateMany: jest.fn(async ({ where, data }) => {
        const p = propostas.find(casa(where)); if (!p) return { count: 0 }; Object.assign(p, data); return { count: 1 }
      }),
    },
  }
  const memoria = {
    chunkText: jest.fn((t: string) => t.match(/.{1,10}/g) ?? []),
    indexDocument: jest.fn(async (_c: string, sourcePath: string, _m: unknown, projectId: string) => { documentos.push({ sourcePath, projectId }) }),
  }
  const anexos = { textoCompleto: jest.fn().mockResolvedValue({ nome: 'curso.pdf', texto: 'conteudo completo do curso', completo: true }) }
  const svc = new HubMemoriaService(prisma as never, memoria as never, anexos as never)
  return { svc, prisma, memoria, anexos, documentos, propostas }
}

describe('HubMemoriaService.propor', () => {
  it('guardar nasce proposta, com título do anexo; a mesma proposta repetida não vira dois cartões', async () => {
    const { svc, propostas } = cenario()
    const a = await svc.propor({ acao: 'guardar', projectId: 'p1', anexoId: 'an-1' }, 'service:agent')
    const b = await svc.propor({ acao: 'guardar', projectId: 'p1', anexoId: 'an-1' }, 'service:agent')
    expect(a).toMatchObject({ status: 'proposta', titulo: 'curso.pdf', anexoId: 'an-1', criadaPor: 'service:agent' })
    expect(b.id).toBe(a.id)
    expect(propostas).toHaveLength(1)
  })

  it.each([
    ['ação desconhecida', { acao: 'apagar_tudo', projectId: 'p1' }, BadRequestException],
    ['projeto inexistente', { acao: 'guardar', projectId: 'nao-existe', anexoId: 'an-1' }, NotFoundException],
    ['anexo inexistente', { acao: 'guardar', projectId: 'p1', anexoId: 'an-9' }, NotFoundException],
    ['remover sem caminho', { acao: 'remover', projectId: 'p1' }, BadRequestException],
    ['remover o que não existe neste projeto', { acao: 'remover', projectId: 'p1', sourcePath: 'docs/nada.md' }, NotFoundException],
  ])('recusa %s', async (_caso, dados, erro) => {
    const { svc, propostas } = cenario()
    await expect(svc.propor(dados, 'x')).rejects.toBeInstanceOf(erro)
    expect(propostas).toHaveLength(0)
  })
})

describe('HubMemoriaService.aprovar e rejeitar', () => {
  it('guardar: texto completo do dono, substitui o mesmo caminho, indexa por trechos e fecha aprovada', async () => {
    const { svc, anexos, memoria, documentos, propostas } = cenario()
    const p = await svc.propor({ acao: 'guardar', projectId: 'p1', anexoId: 'an-1' }, 'service:agent')

    const r = await svc.aprovar(p.id, 'humano:1')
    expect(r.status).toBe('indexando')
    await esperar()

    expect(anexos.textoCompleto).toHaveBeenCalledWith('humano:1', 'an-1')
    const caminho = caminhoNaMemoria('an-1', 'curso.pdf')
    // O trecho antigo do mesmo caminho saiu; ficaram só os novos ("mudar" substitui, não soma).
    expect(documentos.filter((d) => d.sourcePath === caminho)).toHaveLength(memoria.chunkText.mock.results[0].value.length)
    expect(memoria.indexDocument).toHaveBeenCalledWith(expect.any(String), caminho, expect.objectContaining({ source: 'hub-anexo', anexoId: 'an-1' }), 'p1')
    expect(propostas[0]).toMatchObject({ status: 'aprovada', decididaPor: 'humano:1', resultado: expect.objectContaining({ completo: true, sourcePath: caminho }) })
  })

  it('guardar o anexo de OUTRA pessoa falha e fica registrado — nada é indexado', async () => {
    const { svc, anexos, memoria, propostas } = cenario()
    anexos.textoCompleto.mockRejectedValueOnce(new NotFoundException())
    const p = await svc.propor({ acao: 'guardar', projectId: 'p1', anexoId: 'an-1' }, 'service:agent')
    await svc.aprovar(p.id, 'humano:2')
    await esperar()
    expect(memoria.indexDocument).not.toHaveBeenCalled()
    expect(propostas[0].status).toBe('falhou')
  })

  it('remover apaga TODOS os trechos daquele caminho, só neste projeto', async () => {
    const { svc, documentos } = cenario()
    const p = await svc.propor({ acao: 'remover', projectId: 'p1', sourcePath: 'docs/velho.md' }, 'service:agent')
    const r = await svc.aprovar(p.id, 'humano:1')
    expect(r).toMatchObject({ status: 'aprovada', resultado: { removidos: 2 } })
    expect(documentos.filter((d) => d.sourcePath === 'docs/velho.md')).toEqual([{ sourcePath: 'docs/velho.md', projectId: 'outro' }])
  })

  it('decidir duas vezes: a segunda é conflito, e rejeitar não mexe na memória', async () => {
    const { svc, prisma } = cenario()
    const p = await svc.propor({ acao: 'remover', projectId: 'p1', sourcePath: 'docs/velho.md' }, 'x')
    await svc.rejeitar(p.id, 'humano:1')
    await expect(svc.aprovar(p.id, 'humano:1')).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.document.deleteMany).not.toHaveBeenCalled()
  })
})

describe('HubMemoriaController — só pessoa decide', () => {
  it('o AGENT_TOKEN (serviço) propõe, mas não aprova nem rejeita', () => {
    const memoria = { propor: jest.fn(), aprovar: jest.fn(), rejeitar: jest.fn(), pendentes: jest.fn() }
    const c = new HubMemoriaController(memoria as never)
    const servico = { rayzenPrincipal: { id: 'service:agent', type: 'service' as const } } as never
    c.propor({ acao: 'guardar', projectId: 'p1', anexoId: 'an-1' }, servico)
    expect(memoria.propor).toHaveBeenCalled()
    expect(() => c.aprovar('x', servico)).toThrow(ForbiddenException)
    expect(() => c.rejeitar('x', servico)).toThrow(ForbiddenException)
    expect(memoria.aprovar).not.toHaveBeenCalled()
  })
})
