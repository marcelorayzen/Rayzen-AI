import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 13/11 — chamada sem corpo não pode carregar `Content-Type: application/json`.
 *
 * O Fastify recusa JSON vazio com 400 ("Body cannot be empty…") antes de qualquer lógica. O Hub
 * achou isso na primeira proposta real: o envelope nascia em rascunho e travava no `/submit`,
 * a primeira rota sem corpo que uma ferramenta dele chamava. Confirmado contra a API de
 * produção: com o cabeçalho, 400; sem ele, a requisição chega à lógica (404 para id falso).
 *
 * Executa o `api()` REAL recortado de cada transporte, com `fetch` dublado — um teste que só
 * procurasse a linha nova no texto passaria com ela no lugar errado.
 */
const ARQUIVOS = {
  http: join(__dirname, '..', 'rayzen-mcp-http.mjs'),
  stdio: join(__dirname, '..', 'rayzen-mcp.mjs'),
}

type Chamada = { url: string; init: { method: string; headers: Record<string, string>; body?: string } }

function recortarApi(fonte: string): string {
  const inicio = fonte.indexOf('async function api(method, path, body) {')
  if (inicio === -1) throw new Error('api() não encontrada')
  const abre = fonte.indexOf('{', inicio)
  let nivel = 0
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === '{') nivel++
    else if (fonte[i] === '}' && --nivel === 0) return fonte.slice(inicio, i + 1)
  }
  throw new Error('api() não fecha')
}

async function chamar(caminho: string, method: string, body?: unknown): Promise<Chamada> {
  const fonte = readFileSync(caminho, 'utf8')
  const chamadas: Chamada[] = []
  const fetchFalso = async (url: string, init: Chamada['init']) => {
    chamadas.push({ url, init })
    return { ok: true, json: async () => ({}) }
  }
  const loadConfig = async () => ({ apiUrl: 'http://api', apiToken: 'tk' })
  const cabecalhos = async () => ({ Authorization: 'Bearer tk', 'Content-Type': 'application/json' })
  // Os dois transportes nomeiam o ajudante de cabeçalho de jeitos diferentes.
  const fabrica = new Function('fetch', 'loadConfig', 'apiHeaders', 'headers',
    `${recortarApi(fonte)}; return api`)
  const api = fabrica(fetchFalso, loadConfig, cabecalhos, cabecalhos)
  await api(method, '/handoffs/x/submit', body)
  return chamadas[0]
}

describe.each(Object.entries(ARQUIVOS))('api() do transporte %s', (_nome, caminho) => {
  it('POST sem corpo não manda Content-Type (o Fastify recusaria)', async () => {
    const c = await chamar(caminho, 'POST')
    expect(c.init.headers['Content-Type']).toBeUndefined()
    expect(c.init.body).toBeUndefined()
    expect(c.init.headers.Authorization).toBe('Bearer tk')
  })

  it('com corpo, continua JSON', async () => {
    const c = await chamar(caminho, 'POST', { a: 1 })
    expect(c.init.headers['Content-Type']).toBe('application/json')
    expect(c.init.body).toBe('{"a":1}')
  })
})
