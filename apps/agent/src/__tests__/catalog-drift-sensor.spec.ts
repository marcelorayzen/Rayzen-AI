import { compararCatalogo, montarPrompt, NOME_DA_PROPOSTA, rodarUmaVez, slugDoRemoto } from '../catalog-drift-sensor'

jest.mock('../system-heartbeat-client', () => ({ beatComponente: jest.fn() }))

const CATALOGO = '# Catálogo\n\n> Gerado em: 2026-11-12T14:59:19.131Z\n\n| `jarvis:open_url` | low |\n'
const GIT_CONFIG = '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github-rayzen:marcelorayzen/rayzen-ai-private.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'

function deps(gerado: string, opts: { abertos?: unknown[]; projetos?: unknown[] } = {}) {
  const post = jest.fn()
    .mockResolvedValueOnce({ id: 'env-1' })
    .mockResolvedValueOnce({ status: 'awaiting_approval', alcada: 'propoe' })
  const get = jest.fn((url: string) => Promise.resolve(
    url.startsWith('/projects') ? (opts.projetos ?? [{ id: 'proj-1' }]) : (opts.abertos ?? []),
  ))
  return {
    gerar: jest.fn().mockResolvedValue(gerado),
    ler: jest.fn((c: string) => (c.endsWith('config') ? GIT_CONFIG : CATALOGO)),
    api: { get, post } as never,
    get, post,
  }
}

describe('sensor de deriva do catálogo (S2)', () => {
  it('a data de geração não é conteúdo — sem ela, não há deriva', () => {
    const outraData = CATALOGO.replace('2026-11-12T14:59:19.131Z', '2026-11-16T02:04:30.773Z')
    expect(compararCatalogo(outraData, CATALOGO).divergiu).toBe(false)
    expect(compararCatalogo(outraData.replace(/\n/g, '\r\n'), CATALOGO).divergiu).toBe(false)
  })

  it('linha nova no código é deriva, e aparece no resumo', () => {
    const r = compararCatalogo(CATALOGO + '| `jarvis:nova` | none |\n', CATALOGO)
    expect(r.divergiu).toBe(true)
    expect(r.faltam).toEqual(['| `jarvis:nova` | none |'])
    expect(r.sobram).toEqual([])
  })

  it('lê o slug do remoto origin, nos dois formatos', () => {
    expect(slugDoRemoto(GIT_CONFIG)).toBe('rayzen-ai-private')
    expect(slugDoRemoto('[remote "origin"]\n\turl = https://github.com/x/Rayzen-PDV.git\n')).toBe('Rayzen-PDV')
    expect(slugDoRemoto('[core]\n\tbare = false\n')).toBeNull()
  })

  it('em dia: não chama a API', async () => {
    const d = deps(CATALOGO)
    await expect(rodarUmaVez('/repo', d)).resolves.toEqual({ estado: 'em-dia' })
    expect(d.get).not.toHaveBeenCalled()
    expect(d.post).not.toHaveBeenCalled()
  })

  it('divergiu: cria e ENVIA um envelope de sessão no projeto do repositório — e não aprova', async () => {
    const d = deps(CATALOGO + '| `jarvis:nova` | none |\n')
    const r = await rodarUmaVez('/repo', d)
    expect(r).toEqual({ estado: 'proposto', handoffId: 'env-1', alcada: 'propoe' })
    expect(d.get).toHaveBeenCalledWith('/projects?repoSlug=rayzen-ai-private')
    const [rota, corpo] = d.post.mock.calls[0]
    expect(rota).toBe('/handoffs')
    expect(corpo).toMatchObject({
      sourceProjectId: 'proj-1', name: NOME_DA_PROPOSTA, principal: 'sinal:catalog-drift',
      efeitos: [{ actionKey: 'jarvis:supervised_session', payload: { projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' } }],
    })
    expect(d.post.mock.calls[1][0]).toBe('/handoffs/env-1/submit')
    // Nenhuma rota de aprovação ou materialização: a alçada decide, não o sensor.
    expect(d.post.mock.calls.map((c) => c[0]).join(' ')).not.toMatch(/approve|materialize|aprovar/)
  })

  it('não empilha: com a proposta ainda aberta, só a reconhece', async () => {
    const d = deps(CATALOGO + 'x\n', { abertos: [{ id: 'env-0', name: NOME_DA_PROPOSTA, status: 'awaiting_approval', sourceProjectId: 'proj-1' }] })
    await expect(rodarUmaVez('/repo', d)).resolves.toEqual({ estado: 'proposta-aberta', handoffId: 'env-0' })
    expect(d.post).not.toHaveBeenCalled()
  })

  it('proposta anterior já encerrada não impede uma nova', async () => {
    const d = deps(CATALOGO + 'x\n', { abertos: [{ id: 'env-0', name: NOME_DA_PROPOSTA, status: 'completed', sourceProjectId: 'proj-1' }] })
    await expect(rodarUmaVez('/repo', d)).resolves.toMatchObject({ estado: 'proposto' })
  })

  it('sem projeto dono, recusa alto em vez de propor no projeto errado', async () => {
    const d = deps(CATALOGO + 'x\n', { projetos: [] })
    await expect(rodarUmaVez('/repo', d)).rejects.toThrow(/nenhum projeto com repoSlug/)
    expect(d.post).not.toHaveBeenCalled()
  })

  it('o pedido à sessão limita o efeito a um arquivo e manda parar se outro mudar', () => {
    const p = montarPrompt(['nova'], [])
    expect(p).toContain('pnpm gen:catalog')
    expect(p).toMatch(/SÓ `docs\/agent-actions.md` mudou/)
    expect(p).toMatch(/pare e relate/)
  })
})
