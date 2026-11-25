import { ForbiddenException } from '@nestjs/common'
import { Prisma } from '../../../generated/prisma-client-v2'
import { ContextPackService } from '../context-pack.service'
import type { IssueContextPackDto } from '../dto/context-pack.dto'

const dono = { kind: 'human' as const, subject: 'admin', role: 'admin' }
const servico = { kind: 'service' as const, subject: 'agent' }

function versao(over: Record<string, unknown> = {}) {
  return {
    id: 'knowledge-1', logicalKey: 'adr/cache', version: 1, content: 'usar redis',
    contentHash: 'hash-cache', knowledgeType: 'decision', status: 'active',
    validFrom: null, validUntil: null, scopeKey: 'project:p1', ...over,
  }
}

function build(opts: { versoes?: Array<ReturnType<typeof versao>>; candidatos?: unknown[]; secoes?: Record<string, string>; falhas?: string[] } = {}) {
  const guardados = new Map<string, any>()
  const prisma: Record<string, any> = {
    contextPack: {
      create: jest.fn().mockImplementation(({ data }) => {
        const { items, ...resto } = data
        const linha = {
          ...resto,
          // O banco devolve `null` onde o cliente mandou `JsonNull`. Guardar o marcador
          // faria o manifesto lido divergir do assinado — e o teste passaria a medir o
          // mock em vez do round-trip real.
          classes: resto.classes === Prisma.JsonNull ? null : resto.classes,
          items: items.create.map((i: any, idx: number) => ({ id: `item-${idx}`, packId: data.id, ...i })),
        }
        guardados.set(data.id, linha)
        return Promise.resolve(linha)
      }),
      findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(guardados.get(where.id) ?? null)),
      findMany: jest.fn().mockResolvedValue([]),
    },
    knowledgeVersion: {
      findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(
        (opts.versoes ?? [versao()]).filter((v) => !where?.id?.in || where.id.in.includes(v.id)),
      )),
    },
    knowledgeProposal: { findMany: jest.fn().mockResolvedValue(opts.candidatos ?? []) },
  }
  const context = {
    build: jest.fn().mockResolvedValue({
      sections: opts.secoes ?? { project_state: 'Objective: entregar' },
      falhas: opts.falhas ?? [],
      text: '', totalChars: 0, cacheHit: false, builtAt: new Date(),
    }),
  }
  const revisions = { current: jest.fn().mockReturnValue(7), bump: jest.fn() }
  const service = new ContextPackService(prisma as never, context as never, revisions as never)
  return { service, prisma, context, guardados }
}

const pedido: IssueContextPackDto = {
  scopeType: 'project', projectId: 'p1',
  consumer: 'hermes', sessionId: 'sessao-1', purpose: 'responder sobre cache',
}

describe('ContextPackService — leitura autorizada e reproduzível', () => {
  const ownerOriginal = process.env.KNOWLEDGE_OWNER_SUBJECT
  afterEach(() => {
    if (ownerOriginal === undefined) delete process.env.KNOWLEDGE_OWNER_SUBJECT
    else process.env.KNOWLEDGE_OWNER_SUBJECT = ownerOriginal
  })

  it('serve conhecimento aprovado e registra principal, consumidor, sessão e finalidade', async () => {
    const { service } = build()
    const pack = await service.issue(pedido, servico)

    expect(pack.principalKind).toBe('service')
    expect(pack.principalSubject).toBe('agent')
    expect(pack.consumer).toBe('hermes')
    expect(pack.sessionId).toBe('sessao-1')
    expect(pack.purpose).toBe('responder sobre cache')
    expect(pack.text).toContain('usar redis')
    expect(pack.items.find((i) => i.kind === 'knowledge')).toMatchObject({
      itemKey: 'adr/cache', lifecycle: 'approved', version: 1, contentHash: 'hash-cache',
    })
  })

  it('candidato fica de fora por padrão, e nem é consultado', async () => {
    const { service, prisma } = build({ candidatos: [{ id: 'p-1', logicalKey: 'adr/nova', version: 1, content: 'trocar tudo', contentHash: 'h', knowledgeType: 'decision' }] })
    const pack = await service.issue(pedido, servico)

    expect(prisma.knowledgeProposal.findMany).not.toHaveBeenCalled()
    expect(pack.text).not.toContain('trocar tudo')
  })

  it('só o dono pode pedir candidatos, e eles chegam marcados', async () => {
    const candidatos = [{ id: 'p-1', logicalKey: 'adr/nova', version: 2, content: 'trocar tudo', contentHash: 'h', knowledgeType: 'decision' }]

    const recusado = build({ candidatos })
    await expect(recusado.service.issue({ ...pedido, includeCandidates: true }, servico))
      .rejects.toBeInstanceOf(ForbiddenException)
    expect(recusado.prisma.contextPack.create).not.toHaveBeenCalled()

    const permitido = build({ candidatos })
    const pack = await permitido.service.issue({ ...pedido, includeCandidates: true }, dono)

    expect(pack.items.some((i) => i.lifecycle === 'candidate')).toBe(true)
    expect(pack.text).toContain('CANDIDATOS')
    expect(pack.text).toContain('nunca como conhecimento do projeto')
  })

  it('conhecimento fora da janela de validade não entra no pacote', async () => {
    const { service } = build({ versoes: [
      versao(),
      versao({ id: 'knowledge-2', logicalKey: 'adr/expirada', content: 'regra vencida', validUntil: new Date(Date.now() - 1000) }),
      versao({ id: 'knowledge-3', logicalKey: 'adr/futura', content: 'regra futura', validFrom: new Date(Date.now() + 60_000) }),
    ] })
    const pack = await service.issue(pedido, servico)

    expect(pack.text).toContain('usar redis')
    expect(pack.text).not.toContain('regra vencida')
    expect(pack.text).not.toContain('regra futura')
    expect((pack.limits as { knowledgeConsidered: number }).knowledgeConsidered).toBe(1)
  })

  it('item que não cabe no limite é excluído inteiro, nunca cortado no meio', async () => {
    const longo = 'x'.repeat(400)
    const { service } = build({ versoes: [
      versao({ content: longo }),
      versao({ id: 'knowledge-2', logicalKey: 'adr/segunda', content: `${longo}-segunda` }),
    ] })
    const pack = await service.issue({ ...pedido, maxChars: 500, sections: [] }, servico)

    const servidos = pack.items.filter((i) => i.kind === 'knowledge')
    expect(servidos).toHaveLength(1)
    // O hash do item continua sendo o da versão canônica — é isso que a verificação compara.
    expect(servidos[0].contentHash).toBe('hash-cache')
    expect(pack.text).not.toContain('-segunda')
  })

  it('seção que falha entra como indisponível e o texto diz que não é vazio', async () => {
    const { service } = build({ secoes: {}, falhas: ['memory_relevant'] })
    const pack = await service.issue(pedido, servico)

    expect(pack.items.find((i) => i.itemKey === 'memory_relevant')).toMatchObject({
      kind: 'context_section', lifecycle: 'unavailable', reproducible: false,
    })
    expect(pack.text).toContain('Trate como desconhecido, não como vazio')
  })

  it('o manifesto gravado reproduz o hash assinado na emissão', async () => {
    const { service } = build()
    const pack = await service.issue(pedido, servico)

    const verificacao = await service.verify(pack.id)

    expect(verificacao.manifestIntact).toBe(true)
    expect(verificacao.snapshotIntact).toBe(true)
    expect(verificacao.reproducible).toBe(true)
    expect(verificacao.knowledgeRevisionAtIssue).toBe(7)
  })

  it('registro adulterado depois da emissão deixa de bater com a assinatura', async () => {
    const { service, guardados } = build()
    const pack = await service.issue(pedido, servico)

    // Finalidade reescrita no banco: o conteúdo servido continua lá, mas a autorização
    // que ele afirma ter recebido é outra.
    guardados.get(pack.id).purpose = 'outra finalidade'

    const verificacao = await service.verify(pack.id)
    expect(verificacao.manifestIntact).toBe(false)
    expect(verificacao.reproducible).toBe(false)
  })

  it('item superseado depois continua reproduzível — o pacote não mentiu, o mundo andou', async () => {
    const versoes = [versao()]
    const { service } = build({ versoes })
    const pack = await service.issue(pedido, servico)

    versoes[0] = versao({ status: 'superseded' })

    const verificacao = await service.verify(pack.id)
    const item = verificacao.items.find((i) => i.kind === 'knowledge')!
    expect(item.state).toBe('reproducible')
    expect(item.currentlyValid).toBe('superseded')
    expect(verificacao.reproducible).toBe(true)
  })

  it('conteúdo trocado por baixo é conteúdo alterado, não supersessão', async () => {
    const versoes = [versao()]
    const { service } = build({ versoes })
    const pack = await service.issue(pedido, servico)

    versoes[0] = versao({ contentHash: 'outro-hash' })

    const verificacao = await service.verify(pack.id)
    expect(verificacao.items.find((i) => i.kind === 'knowledge')!.state).toBe('content_changed')
    expect(verificacao.reproducible).toBe(false)
  })

  it('seção volátil se declara snapshot, nunca reproduzível', async () => {
    const { service } = build()
    const pack = await service.issue(pedido, servico)

    const verificacao = await service.verify(pack.id)
    const secao = verificacao.items.find((i) => i.kind === 'context_section')!
    expect(secao.state).toBe('snapshot_only')
    expect(secao.reproducible).toBe(false)
  })

  it('pacote sem conhecimento governado não se declara reproduzível por vacuidade', async () => {
    const { service } = build({ versoes: [] })
    const pack = await service.issue(pedido, servico)

    const verificacao = await service.verify(pack.id)
    expect(verificacao.reproducible).toBe(false)
  })

  it('a autorização expira; a evidência não', async () => {
    const { service, guardados } = build()
    const pack = await service.issue(pedido, servico)

    guardados.get(pack.id).authorizationExpiresAt = new Date(Date.now() - 1000)

    await expect(service.content(pack.id, servico)).rejects.toBeInstanceOf(ForbiddenException)

    const manifesto = await service.get(pack.id)
    expect(manifesto.id).toBe(pack.id)
    expect(manifesto.items.length).toBeGreaterThan(0)
    expect((await service.verify(pack.id)).authorizationExpired).toBe(true)
  })

  it('o conteúdo é de quem recebeu a autorização; o dono lê para auditar', async () => {
    const { service } = build()
    const pack = await service.issue(pedido, servico)

    await expect(service.content(pack.id, { kind: 'service', subject: 'outro' }))
      .rejects.toBeInstanceOf(ForbiddenException)

    expect((await service.content(pack.id, servico)).text).toContain('usar redis')
    expect((await service.content(pack.id, dono)).text).toContain('usar redis')
  })
})
