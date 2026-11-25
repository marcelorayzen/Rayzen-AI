import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { escreverIntegracaoRayzen } from '../create-project-folder'

/**
 * O gerador de projeto escreve a integração com o Rayzen. Três defeitos reais,
 * todos observados no `Rayzen Commerce Platform` e corrigidos em 2026-08-17:
 *
 * 1. `mcpServers` ia para `.claude/settings.json`, que não é lido para isso — as
 *    tools `rayzen_*` simplesmente não existiam no projeto, sem erro nenhum.
 * 2. O `AGENT_TOKEN` era gravado no arquivo, e o gerador faz `git init && git add .
 *    && git commit` logo depois: o token entrava no **primeiro commit do repo**.
 * 3. `PROJECT_ID` vinha fixado, reativando o fallback legado do MCP — a origem do
 *    incidente da Urna, quando um blueprint foi gravado no projeto errado.
 *
 * O (2) é o que este arquivo existe para impedir de voltar: é silencioso, é
 * irreversível depois do push, e só aparece quando alguém audita o histórico.
 */
describe('escreverIntegracaoRayzen', () => {
  let dir: string
  const tokenOriginal = process.env.AGENT_TOKEN

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rayzen-gen-'))
    // Com o ambiente "sujo": é exatamente assim que o gerador roda de verdade,
    // e era nessa condição que o token vazava para dentro do repositório.
    process.env.AGENT_TOKEN = 'token-secreto-que-nao-pode-vazar'
  })

  afterEach(async () => {
    if (tokenOriginal === undefined) delete process.env.AGENT_TOKEN
    else process.env.AGENT_TOKEN = tokenOriginal
    await rm(dir, { recursive: true, force: true })
  })

  const ler = (rel: string) => readFile(join(dir, rel), 'utf8')

  it('nenhum arquivo gerado contém o AGENT_TOKEN', async () => {
    const arquivos = await escreverIntegracaoRayzen(dir)

    expect(arquivos.length).toBeGreaterThan(0)
    for (const rel of arquivos) {
      expect(await ler(rel)).not.toContain('token-secreto-que-nao-pode-vazar')
    }
  })

  it('o MCP vai para .mcp.json na raiz, que é onde o Claude Code procura', async () => {
    await escreverIntegracaoRayzen(dir)
    const mcp = JSON.parse(await ler('.mcp.json'))

    expect(Object.keys(mcp.mcpServers)).toEqual(['rayzen'])
    expect(mcp.mcpServers.rayzen.command).toBe('node')
    expect(mcp.mcpServers.rayzen.args[0]).toMatch(/rayzen-mcp\.mjs$/)
  })

  it('settings.json carrega os hooks e NÃO declara mcpServers', async () => {
    await escreverIntegracaoRayzen(dir)
    const settings = JSON.parse(await ler('.claude/settings.json'))

    expect(Object.keys(settings.hooks).sort()).toEqual(['PostToolUse', 'Stop', 'UserPromptSubmit'])
    // Declarar aqui é o defeito original: fica plausível e não funciona.
    expect(settings.mcpServers).toBeUndefined()
  })

  it('não fixa projectId em lugar nenhum', async () => {
    for (const rel of await escreverIntegracaoRayzen(dir)) {
      const txt = await ler(rel)
      expect(txt).not.toMatch(/PROJECT_ID/)
      expect(txt).not.toMatch(/"projectId"/)
    }
  })

  it('aponta para os .mjs em src/, que rodam sem build', async () => {
    await escreverIntegracaoRayzen(dir)
    // `dist/` desatualizado não pode quebrar projeto recém-criado.
    const alvos = [
      JSON.parse(await ler('.mcp.json')).mcpServers.rayzen.args[0],
      ...JSON.parse(await ler('.claude/settings.json')).hooks.UserPromptSubmit[0].hooks.map(
        (h: { command: string }) => h.command,
      ),
    ]
    for (const alvo of alvos) {
      expect(alvo).toContain('src')
      expect(alvo).not.toContain('dist')
    }
  })

  it('comandos de hook citam o caminho entre aspas', async () => {
    await escreverIntegracaoRayzen(dir)
    // Caminho com espaço vira dois argumentos sem isso, e o hook falha calado.
    const settings = JSON.parse(await ler('.claude/settings.json'))
    for (const grupo of Object.values(settings.hooks) as Array<Array<{ hooks: Array<{ command: string }> }>>) {
      for (const entrada of grupo) {
        for (const h of entrada.hooks) expect(h.command).toMatch(/^node ".+\.mjs"$/)
      }
    }
  })
})
