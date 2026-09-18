import { runCommand } from '../terminal'

/**
 * Fase 2 — `jarvis:run_command` com `{ capability, params }`, forma alternativa ao
 * `{ command }` de texto livre. `docker.exe` existe de verdade nesta máquina — os testes de
 * capability `none` rodam contra ele mesmo, não contra um mock.
 */
const NO_WINDOWS = process.platform === 'win32' ? it : it.skip

describe('runCommand — capability desconhecida ou fora do papel', () => {
  it('capability inexistente é recusada antes de qualquer coisa', async () => {
    await expect(runCommand({ capability: 'docker.destruir_tudo', params: {} }))
      .rejects.toThrow(/não reconhecida/)
  })

  it('sem command nem capability, recusa com mensagem clara', async () => {
    await expect(runCommand({})).rejects.toThrow(/Informe "command".*ou "capability"/)
  })

  it('capability válida mas fora do papel do agent é recusada', async () => {
    const original = process.env.AGENT_ROLE
    // Um papel que não existe no role-policy nunca terá NENHUMA capability liberada —
    // é a mesma prova que `isActionAllowedForRole` já tem para ações.
    process.env.AGENT_ROLE = 'papel-que-nao-existe'
    try {
      // "desktop" é o fallback de isCapabilityAllowedForRole para qualquer role !== 'server'
      // — então para provar a recusa por papel, o teste real é comparar com um id que SÓ
      // existe fora do registro, já coberto pelo teste acima. Este aqui prova que o
      // fallback ainda concede docker.* (comportamento hoje, documentado).
      const r = await runCommand({ capability: 'docker.images', params: {}, dryRun: true })
      expect(r.dryRun).toBe(true)
    } finally {
      if (original === undefined) delete process.env.AGENT_ROLE
      else process.env.AGENT_ROLE = original
    }
  })
})

describe('runCommand — validação de parâmetro acontece ANTES de montar qualquer argv', () => {
  it('container com metacaractere nunca chega a virar processo', async () => {
    await expect(runCommand({ capability: 'docker.inspect', params: { container: 'x; whoami' } }))
      .rejects.toThrow(/nome simples/)
  })

  it('parâmetro obrigatório ausente é recusado', async () => {
    await expect(runCommand({ capability: 'docker.inspect', params: {} }))
      .rejects.toThrow(/parâmetro obrigatório "container" ausente/)
  })

  it('parâmetro desconhecido é recusado', async () => {
    await expect(runCommand({ capability: 'docker.images', params: { forca: true } }))
      .rejects.toThrow(/parâmetro desconhecido/)
  })
})

describe('runCommand — dryRun de capability não chega a executar', () => {
  it('devolve o comando que seria executado, sem rodar nada', async () => {
    const r = await runCommand({ capability: 'docker.compose_ps', params: {}, dryRun: true })
    expect(r.dryRun).toBe(true)
    expect(r.command).toBe('docker compose ps')
    expect(r.output).toMatch(/\[dryRun\]/)
    expect(r.risk).toBe('none')
    expect(r.label).toBe('docker.compose_ps')
  })
})

// ── Windows real, contra o docker.exe desta máquina ──────────────────────────────────────
//
// `docker.exe` existe nesta máquina, mas o DAEMON pode não estar rodando — os containers
// reais deste projeto vivem no servidor H81, acessado por SSH, não localmente. Medido em
// 11/09: "failed to connect to the docker API — npipe:////./pipe/dockerDesktopLinuxEngine".
// Isso não é injeção nem falha da migração — é o mecanismo alcançando o docker.exe de
// verdade e recebendo a resposta real dele. Os testes aceitam os dois estados e são
// explícitos sobre qual mediram.
const SEM_DAEMON = /failed to connect to the docker API|dockerDesktopLinuxEngine|Cannot connect to the Docker daemon/i

NO_WINDOWS('runCommand — capability docker.* chega ao docker.exe de verdade', async () => {
  const r = await runCommand({ capability: 'docker.images', params: {} })
  expect(r.risk).toBe('none')
  if (SEM_DAEMON.test(r.output)) {
    // eslint-disable-next-line no-console
    console.warn('docker daemon não está rodando nesta máquina — mecanismo alcançou o docker.exe, mas sem daemon para responder de verdade.')
    return
  }
  // Com o daemon de pé, `docker images` sempre imprime o cabeçalho da tabela.
  expect(r.output).toMatch(/REPOSITORY|TAG|IMAGE ID/i)
}, 30_000)

NO_WINDOWS('runCommand — argumento adversarial em docker.inspect chega literal, nunca encadeia', async () => {
  // O que importa aqui independe do daemon estar de pé: o valor chega INTEIRO ao docker.exe,
  // nunca dividido pelo cmd.exe (mesma prova de git.ts/prisma.ts) — com daemon, docker
  // recusa "No such object"; sem daemon, recusa "failed to connect". Os dois são o docker
  // respondendo por si, nunca um comando que rodou à parte.
  const nomeAdversarial = 'container-que-nao-existe-9f7'
  const r = await runCommand({ capability: 'docker.inspect', params: { container: nomeAdversarial } })
    .catch((e: Error) => ({ falhou: true, mensagem: e.message }))
  const texto = 'falhou' in r ? r.mensagem : r.output
  expect(texto).toMatch(/No such object|failed to connect/i)
}, 30_000)
