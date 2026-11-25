import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

/**
 * G6, fatia 1 — o deploy só dispara com push em `main` DO REPOSITÓRIO DO RAYZEN.
 *
 * `webhook-deploy.mjs` é ESM e este spec é CommonJS: roda o módulo REAL num subprocesso (mesma
 * técnica de `proposta-de-sessao.spec.ts`). O servidor é lido como texto para confirmar que a
 * regra está LIGADA no handler — importá-lo abriria uma porta de verdade.
 */
const MODULO = join(__dirname, '..', 'webhook-deploy.mjs')
const SERVIDOR = join(__dirname, '..', 'rayzen-mcp-http.mjs')

type Decisao = { deployar: boolean; motivo: string }

function decidir(casos: Array<[string | undefined, unknown]>): Decisao[] {
  const script =
    `import(${JSON.stringify(pathToFileURL(MODULO).href)}).then((m) => {` +
    `const casos = JSON.parse(process.argv[1]);` +
    `process.stdout.write(JSON.stringify(casos.map(([e, p]) => m.decidirDeploy(e, p))))})`
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(casos)], { encoding: 'utf8' }))
}

const pushEmMain = (fullName: unknown) => ({ ref: 'refs/heads/main', repository: { full_name: fullName } })

describe('decidirDeploy — o módulo real', () => {
  it('push em main do rayzen-ai-private dispara', () => {
    expect(decidir([['push', pushEmMain('marcelorayzen/rayzen-ai-private')]])[0].deployar).toBe(true)
  })

  it('a grafia do nome não importa, como no GitHub', () => {
    expect(decidir([['push', pushEmMain('MarceloRayzen/Rayzen-AI-Private')]])[0].deployar).toBe(true)
  })

  it('push em main de OUTRO repositório com assinatura válida não dispara, e diz de onde veio', () => {
    const [d] = decidir([['push', pushEmMain('marcelorayzen/rayzen-marcenaria')]])
    expect(d.deployar).toBe(false)
    expect(d.motivo).toMatch(/rayzen-marcenaria/)
  })

  it('sem repositório no corpo, não dispara — ausência nunca vira permissão', () => {
    expect(decidir([['push', { ref: 'refs/heads/main' }], ['push', pushEmMain(42)]]).map((d) => d.deployar)).toEqual([false, false])
  })

  it('o que já não disparava continua sem disparar: outro ramo, outro evento, ping', () => {
    const r = decidir([
      ['push', { ref: 'refs/heads/feature', repository: { full_name: 'marcelorayzen/rayzen-ai-private' } }],
      ['pull_request', pushEmMain('marcelorayzen/rayzen-ai-private')],
      ['ping', {}],
      [undefined, {}],
    ])
    expect(r.map((d) => d.deployar)).toEqual([false, false, false, false])
  })
})

describe('/webhook/github-build — usa a decisão do módulo', () => {
  const FONTE = readFileSync(SERVIDOR, 'utf8')
  const rota = FONTE.slice(FONTE.indexOf("url.pathname === '/webhook/github-build'"), FONTE.indexOf('triggerRemoteBuild()', FONTE.indexOf("url.pathname === '/webhook/github-build'")))

  it('confere a assinatura antes e decide o deploy pelo módulo, sem a regra antiga só de ref', () => {
    expect(rota).toMatch(/verifyGithubSignature\(rawBody, signature\)/)
    expect(rota).toMatch(/const decisao = decidirDeploy\(event, payload\)/)
    expect(rota).toMatch(/if \(!decisao\.deployar\)/)
    expect(rota).not.toMatch(/event !== 'push' \|\| payload\.ref !== 'refs\/heads\/main'/)
    expect(rota.indexOf('verifyGithubSignature')).toBeLessThan(rota.indexOf('decidirDeploy'))
  })
})
