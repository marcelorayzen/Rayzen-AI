import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * `rayzen_update_planning` mescla os milestones novos com os que já estão gravados,
 * porque `updatePlanning()` na API faz replace bruto do campo — um patch parcial
 * apagaria os outros.
 *
 * A chave dessa mescla era o `id`. Funcionava enquanto quem chamava mandava id, e
 * passou a destruir dado quando o projeto adotou a regra oposta — **nunca peça `id` ao
 * LLM** (ver `project_llm_never_assigns_id`). Chamador correto manda só `title`, então
 * `m.id` era `undefined` para todos e `merged.set(undefined, …)` colapsava a lista
 * inteira numa entrada só: **de 4 milestones enviados, sobrevivia o último**.
 *
 * Medido em 2026-08-17 contra o servidor real: 4 enviados, 2 gravados (1 pré-existente
 * + o último dos meus). HTTP 200, resposta de sucesso, nenhum erro em lugar nenhum.
 *
 * Os dois transportes (stdio e HTTP) carregam o mesmo trecho copiado — foi assim que o
 * defeito nasceu duplicado, então o drift entre eles também é testado aqui.
 *
 * ── Por que o teste executa o BLOCO e não a função auxiliar ──────────────────────
 * A primeira versão deste arquivo extraía só `chaveMilestone` e a exercitava sozinha.
 * Validada contra o bug reintroduzido, **passou verde**: a chave continuava correta e
 * sem uso, enquanto a mescla real voltava a usar `m.id`. Testar o ajudante em vez do
 * caminho que roda é o mesmo defeito do "Invariante 2" que testava o próprio mock.
 * Agora o bloco inteiro é recortado do `.mjs` e executado com um `api()` de mentira.
 *
 * Lê o `.mjs` como texto porque esses arquivos rodam direto do `src`, sem build, e não
 * são importáveis por uma suíte ts-jest. Mesmo recurso de `hook-signal-quality.spec.ts`.
 */

const ARQUIVOS: Record<string, string> = {
  stdio: join(__dirname, '..', 'rayzen-mcp.mjs'),
  http:  join(__dirname, '..', 'rayzen-mcp-http.mjs'),
}

type Milestone = { id?: string; title?: string; status?: string }

/** Recorta o corpo de `if (args.milestones) { … }` contando chaves. */
function extrairBlocoDeMescla(fonte: string): string {
  const marca = fonte.indexOf('if (args.milestones) {')
  if (marca === -1) throw new Error('bloco `if (args.milestones)` não encontrado')
  const abre = fonte.indexOf('{', marca)
  let nivel = 0
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === '{') nivel++
    else if (fonte[i] === '}') {
      nivel--
      if (nivel === 0) return fonte.slice(abre + 1, i)
    }
  }
  throw new Error('bloco `if (args.milestones)` não fecha')
}

/**
 * Executa o bloco real com `api()` dublado. Devolve o `patch.milestones` que o handler
 * teria enviado no PATCH — é esse valor que a API grava.
 */
function mesclarComoOHandler(
  caminho: string,
  atuais: Milestone[],
  novos: Milestone[],
): Promise<Milestone[]> {
  const bloco = extrairBlocoDeMescla(readFileSync(caminho, 'utf8'))
  const corpo = `return (async () => { ${bloco}; return patch.milestones })()`
  const executar = new Function('args', 'projectId', 'api', 'patch', corpo) as (
    args: { milestones: Milestone[] },
    projectId: string,
    api: () => Promise<{ milestones: Milestone[] }>,
    patch: { milestones?: Milestone[] },
  ) => Promise<Milestone[]>

  return executar(
    { milestones: novos },
    'projeto-de-teste',
    async () => ({ milestones: atuais }),
    {},
  )
}

describe.each(Object.keys(ARQUIVOS))('rayzen_update_planning (%s)', (nome) => {
  const caminho = ARQUIVOS[nome]

  it('milestones sem id, com títulos distintos, não colapsam', async () => {
    // A regressão exata: sem id, o merge por `m.id` deixava passar só o último.
    const novos: Milestone[] = [
      { title: 'Deploy no servidor executado', status: 'done' },
      { title: 'Documentacao aponta para o H81', status: 'done' },
      { title: 'Onboarding validado ponta a ponta', status: 'pending' },
      { title: 'Webhook recria o container', status: 'pending' },
    ]

    const saida = await mesclarComoOHandler(caminho, [], novos)

    expect(saida).toHaveLength(4)
    expect(saida.map((m) => m.title)).toEqual(novos.map((m) => m.title))
  })

  it('mesmo título reaproveita a entrada existente, preservando o id já gravado', async () => {
    const atuais: Milestone[] = [{ id: 'milestone-0-deploy', title: 'Deploy no servidor', status: 'pending' }]

    const saida = await mesclarComoOHandler(caminho, atuais, [{ title: 'Deploy no servidor', status: 'done' }])

    expect(saida).toHaveLength(1)
    expect(saida[0].id).toBe('milestone-0-deploy')   // id estável, não recunhado
    expect(saida[0].status).toBe('done')             // e a transição de status vale
  })

  it('não apaga milestone existente que o patch não menciona', async () => {
    // O motivo de a mescla existir; ver memory/project-predeploy-hardening.md.
    const atuais: Milestone[] = [{ id: 'milestone-0-antigo', title: 'Milestone antigo', status: 'active' }]

    const saida = await mesclarComoOHandler(caminho, atuais, [{ title: 'Milestone novo', status: 'pending' }])

    expect(saida.map((m) => m.title).sort()).toEqual(['Milestone antigo', 'Milestone novo'])
  })

  it('acento e caixa não criam milestone duplicado', async () => {
    // Mesma normalização do titleKey() da API; se divergir, um lado cria duplicata
    // que o outro considera o mesmo item.
    const atuais: Milestone[] = [{ id: 'm-0', title: 'Validação do Onboarding', status: 'pending' }]

    const saida = await mesclarComoOHandler(caminho, atuais, [{ title: 'VALIDACAO DO ONBOARDING', status: 'done' }])

    expect(saida).toHaveLength(1)
    expect(saida[0].id).toBe('m-0')
  })
})

describe('anti-drift entre os dois transportes', () => {
  it('stdio e HTTP mesclam exatamente igual', () => {
    const [a, b] = Object.values(ARQUIVOS).map((p) => extrairBlocoDeMescla(readFileSync(p, 'utf8')))
    expect(a.replace(/\s+/g, ' ').trim()).toBe(b.replace(/\s+/g, ' ').trim())
  })
})
