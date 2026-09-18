/**
 * Fase 3 — despacho por capability aceita `projectId`, preferido a `path`. A correção de
 * `resolverWorkdir()` em si já está coberta em `exec/__tests__/workdir.spec.ts` (contra o
 * `.mjs` real); aqui o que importa é o CONTRATO de `runCommand` com ele: chama, usa o
 * resultado como cwd, e recusa alto quando não acha — nunca cai de volta para `path` livre
 * nem para `process.cwd()`.
 */
jest.mock('../../exec/workdir', () => ({
  resolverWorkdir: jest.fn(),
}))

import { join } from 'path'
import { runCommand } from '../terminal'
import { resolverWorkdir } from '../../exec/workdir'

const resolverWorkdirMock = resolverWorkdir as jest.Mock

describe('runCommand — capability com projectId (Fase 3)', () => {
  beforeEach(() => resolverWorkdirMock.mockReset())

  it('projectId resolvido vira o cwd da capability', async () => {
    resolverWorkdirMock.mockResolvedValue('C:\\Users\\marce\\Projects\\algum-projeto')

    const r = await runCommand({
      capability: 'docker.compose_ps', params: {}, projectId: 'p1', dryRun: true,
    })

    expect(resolverWorkdirMock).toHaveBeenCalledWith('p1')
    expect(r.output).toContain('C:\\Users\\marce\\Projects\\algum-projeto')
  })

  it('projectId não resolvido recusa alto — nunca cai para process.cwd() em silêncio', async () => {
    resolverWorkdirMock.mockResolvedValue(null)

    await expect(runCommand({ capability: 'docker.images', params: {}, projectId: 'p-fantasma' }))
      .rejects.toThrow(/não tem checkout local conhecido/)
  })

  it('com projectId E path ao mesmo tempo, projectId vence', async () => {
    resolverWorkdirMock.mockResolvedValue('C:\\Users\\marce\\Projects\\do-projectid')

    const r = await runCommand({
      capability: 'docker.compose_ps', params: {},
      projectId: 'p1', path: 'C:\\Users\\marce\\Projects\\do-path-livre',
      dryRun: true,
    })

    expect(r.output).toContain('do-projectid')
    expect(r.output).not.toContain('do-path-livre')
  })

  it('sem projectId, o comportamento por path livre continua igual (compatibilidade)', async () => {
    // `join()`, não `\\` fixo — este path é validado de verdade pelo path-guard (ao contrário
    // dos outros testes acima, onde `resolverWorkdir` está mockado); separador hardcoded quebra
    // no runner Linux do CI.
    const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''
    const r = await runCommand({
      capability: 'docker.compose_ps', params: {},
      path: join(HOME, 'Projects', 'rayzen-ai'), dryRun: true,
    })

    expect(resolverWorkdirMock).not.toHaveBeenCalled()
    expect(r.output).toContain('rayzen-ai')
  })
})
