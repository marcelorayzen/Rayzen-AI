import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const hook = resolve(__dirname, '..', 'rayzen-hook.mjs')
const repo = resolve(__dirname, '..', '..', '..', '..', '..')

describe('rayzen-hook — evento precisa de projeto dono', () => {
  let server: Server
  let baseUrl: string
  let scratch: string
  let projectFound = false
  const posted: Array<Record<string, unknown>> = []

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'rayzen-hook-scope-'))
    server = createServer((req, res) => {
      if (req.method === 'GET' && req.url?.startsWith('/projects?repoSlug=')) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(projectFound ? [{ id: 'project-registered' }] : []))
        return
      }
      if (req.method === 'POST' && req.url === '/events/cli') {
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', () => {
          posted.push(JSON.parse(body) as Record<string, unknown>)
          res.end('{}')
        })
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('porta de teste indisponível')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((ok) => server.close(() => ok()))
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  beforeEach(() => { posted.length = 0 })

  function runHook(
    toolName = 'Bash',
    toolInput: Record<string, string> = { description: 'verificação de escopo' },
    payloadCwd: string | null = repo,
    childCwd = scratch,
  ): Promise<{ code: number | null; stderr: string }> {
    return new Promise((ok, fail) => {
      const child = spawn(process.execPath, [hook], {
        cwd: childCwd, // o processo do hook não precisa rodar dentro do repositório
        env: {
          ...process.env,
          RAYZEN_API_URL: baseUrl,
          RAYZEN_API_TOKEN: 'test-token',
          RAYZEN_PROJECT_ID: '',
          TMP: scratch,
          TEMP: scratch,
          TMPDIR: scratch,
        },
        windowsHide: true,
      })
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      child.on('error', fail)
      child.on('close', (code) => ok({ code, stderr }))
      child.stdin.end(JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: toolName,
        tool_input: toolInput,
        cwd: payloadCwd ?? undefined,
        session_id: 'session-scope-test',
      }))
    })
  }

  it('não transmite evento quando a API não conhece o repoSlug', async () => {
    projectFound = false
    const result = await runHook()
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('projectId não resolvido')
    expect(posted).toHaveLength(0)
  })

  it('não transmite conteúdo de Write quando o projeto é desconhecido', async () => {
    projectFound = false
    const result = await runHook('Write', { file_path: join(repo, 'README.md') })
    expect(result.code).toBe(0) // o aviso visível é limitado a uma vez por hora
    expect(result.stderr).toContain('projectId não resolvido')
    expect(posted).toHaveLength(0)
  })

  it('não atribui ao repo do processo um payload sem cwd', async () => {
    projectFound = true
    const result = await runHook('Bash', { description: 'sem origem' }, null, repo)
    expect(result.code).toBe(0) // aviso já limitado pelo primeiro caso
    expect(result.stderr).toContain('projectId não resolvido')
    expect(posted).toHaveLength(0)
  })

  it('transmite o mesmo evento com projectId quando o projeto é conhecido', async () => {
    projectFound = true
    const result = await runHook()
    expect(result.code).toBe(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ projectId: 'project-registered', tool_name: 'Bash' })
    expect(posted[0].git).toEqual(expect.objectContaining({ commitHash: expect.any(String) }))
  })

  it('descarta timing de outro projeto em hook global compartilhado', async () => {
    projectFound = true
    writeFileSync(join(scratch, 'rayzen-ctx-timing.json'), JSON.stringify({
      ts: Date.now(),
      projectId: 'another-project',
      hookDurationMs: 12,
    }))
    const result = await runHook()
    expect(result.code).toBe(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ projectId: 'project-registered', tool_name: 'Bash' })
  })
})
