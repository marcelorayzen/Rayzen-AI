import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { HubController } from '../hub.controller'

describe('HubController — fronteira HTTP H2', () => {
  function setup() {
    const turns = { submit: jest.fn(), get: jest.fn(), events: jest.fn() }
    return { controller: new HubController(turns as never), turns }
  }

  it('deriva principal humano do guard e não aceita texto vazio', () => {
    const { controller, turns } = setup()
    const request = { headers: {}, rayzenPrincipal: { id: 'marcelo', type: 'human' as const } }

    controller.submit({ text: '  olá Hub  ' }, 'project-a', 'idem-1', request)

    expect(turns.submit).toHaveBeenCalledWith({
      principalId: 'marcelo', projectId: 'project-a', text: 'olá Hub', idempotencyKey: 'idem-1',
      // Só `true` literal renova a sessão do Hermes; ausente vira false, nunca truthy por acaso.
      novaConversa: false,
    })
    expect(() => controller.submit({ text: ' ' }, undefined, undefined, request)).toThrow(BadRequestException)
  })

  // HC7c (23/11): a resposta curta só liga com `true` de verdade.
  it('porVoz só passa adiante quando é true literal', () => {
    const { controller, turns } = setup()
    const request = { headers: {}, rayzenPrincipal: { id: 'marcelo', type: 'human' as const } }

    controller.submit({ text: 'oi', porVoz: true }, undefined, 'idem-v1', request)
    expect(turns.submit).toHaveBeenLastCalledWith(expect.objectContaining({ porVoz: true }))

    controller.submit({ text: 'oi', porVoz: 'true' as unknown as boolean }, undefined, 'idem-v2', request)
    expect(turns.submit).toHaveBeenLastCalledWith(expect.not.objectContaining({ porVoz: expect.anything() }))

    controller.submit({ text: 'oi' }, undefined, 'idem-v3', request)
    expect(turns.submit).toHaveBeenLastCalledWith(expect.not.objectContaining({ porVoz: expect.anything() }))
  })

  // HC2 (21/11): com anexo, o texto pode vir vazio (só o print); lista malformada é recusada.
  it('anexo sem texto passa adiante; anexoIds que não é lista de textos é 400', () => {
    const { controller, turns } = setup()
    const request = { headers: {}, rayzenPrincipal: { id: 'marcelo', type: 'human' as const } }

    controller.submit({ text: '', anexoIds: ['an-1'] }, undefined, 'idem-a', request)
    expect(turns.submit).toHaveBeenCalledWith(expect.objectContaining({ text: '', anexoIds: ['an-1'] }))
    expect(() => controller.submit({ text: 'x', anexoIds: 'an-1' }, undefined, undefined, request)).toThrow(BadRequestException)
    expect(() => controller.submit({ text: 'x', anexoIds: ['an-1', 7] }, undefined, undefined, request)).toThrow(BadRequestException)
    expect(() => controller.submit({ text: '', anexoIds: [] }, undefined, undefined, request)).toThrow(BadRequestException)
  })

  it('recusa token de serviço tanto no envio quanto no replay', () => {
    const { controller } = setup()
    const request = { headers: {}, rayzenPrincipal: { id: 'service:agent', type: 'service' as const } }

    expect(() => controller.submit({ text: 'não' }, undefined, undefined, request)).toThrow(ForbiddenException)
    expect(() => controller.events('turn-1', request)).toThrow(ForbiddenException)
    expect(() => controller.getTurn('turn-1', request)).toThrow(ForbiddenException)
  })

  it('responde 202 apenas quando o envio pede modo async', () => {
    const { controller, turns } = setup()
    const request = { headers: {}, rayzenPrincipal: { id: 'marcelo', type: 'human' as const } }
    const reply = { status: jest.fn() }

    controller.submit({ text: 'olá', modo: 'async' }, undefined, 'idem-async', request, undefined, reply as never)

    expect(reply.status).toHaveBeenCalledWith(202)
    expect(turns.submit).toHaveBeenCalledWith(expect.objectContaining({ modo: 'async', idempotencyKey: 'idem-async' }))
  })

  it('mantém o modo sync sem substituir o status HTTP 200 padrão', () => {
    const { controller, turns } = setup()
    const request = { headers: {}, rayzenPrincipal: { id: 'marcelo', type: 'human' as const } }
    const reply = { status: jest.fn() }

    controller.submit({ text: 'olá', modo: 'sync' }, undefined, 'idem-sync', request, undefined, reply as never)

    expect(reply.status).not.toHaveBeenCalled()
    expect(turns.submit).toHaveBeenCalledWith(expect.not.objectContaining({ modo: 'async' }))
  })

  it('oculta turno de outro principal como 404', async () => {
    const { controller, turns } = setup()
    const request = { headers: {}, rayzenPrincipal: { id: 'marcelo', type: 'human' as const } }
    turns.get.mockRejectedValue(new NotFoundException())

    await expect(controller.getTurn('turn-foreign', request)).rejects.toBeInstanceOf(NotFoundException)
    expect(turns.get).toHaveBeenCalledWith('marcelo', 'turn-foreign')
  })

  it('accepts only a V1 handoff link in an explicitly selected project', () => {
    const turns = { submit: jest.fn(), events: jest.fn() }
    const workItems = { link: jest.fn() }
    const controller = new HubController(turns as never, workItems as never)
    const request = { headers: {}, rayzenPrincipal: { id: 'marcelo', type: 'human' as const } }

    controller.linkWorkItem('project-a', { kind: 'project_handoff', sourceSystem: 'v1', sourceId: 'handoff-1' }, request)

    expect(workItems.link).toHaveBeenCalledWith('marcelo', 'project-a', { kind: 'project_handoff', sourceSystem: 'v1', sourceId: 'handoff-1' })
    expect(() => controller.linkWorkItem('project-a', { kind: 'mission', sourceSystem: 'v2', sourceId: 'mission-1' }, request)).toThrow(BadRequestException)
    expect(() => controller.linkWorkItem(undefined, { kind: 'project_handoff', sourceSystem: 'v1', sourceId: 'handoff-1' }, request)).toThrow(BadRequestException)
  })
})
