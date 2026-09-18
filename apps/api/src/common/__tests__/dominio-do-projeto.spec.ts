import { readFileSync } from 'fs'
import { join } from 'path'
import { DOMINIOS, ehDominioValido, rotuloDeDominio } from '../dominio-do-projeto.const'
import { blocoDeTrechosDeTerceiro } from '../../modules/memory/trecho-de-terceiro.const'

/**
 * ── A separação que o SOUL promete, finalmente no DADO ──────────────────────
 *
 * *"Respeito a separação entre vida pessoal, projetos e clientes"* — e até 18/09 isso era só uma
 * regra de atribuição no prompt. O único sinal que o bloco entregava era o `sourcePath`, do qual
 * "isto é de cliente" precisa ser **deduzido** por quem lê. Deduzir é exatamente o que a separação
 * não deveria exigir.
 *
 * Medido no mesmo dia: `Project` não tinha campo de domínio, e o `project_catalog` da V2 (que tem
 * `tags`) estava preenchido em **1 de 10** projetos, num schema que a V1 nem alcança. O lugar
 * existia e estava vazio.
 */

describe('ehDominioValido', () => {
  it('aceita os três domínios declarados', () => {
    for (const d of DOMINIOS) expect(ehDominioValido(d)).toBe(true)
  })

  it('recusa qualquer outra coisa', () => {
    expect(ehDominioValido('secreto')).toBe(false)
    expect(ehDominioValido(null)).toBe(false)
    expect(ehDominioValido(undefined)).toBe(false)
    expect(ehDominioValido(42)).toBe(false)
  })
})

describe('rotuloDeDominio — quem não sabe não afirma', () => {
  it('classificado vira rótulo', () => {
    expect(rotuloDeDominio('cliente')).toBe('cliente')
  })

  /**
   * Nulo é **não classificado**, e isso não é o mesmo que "sem domínio". A classificação é
   * curadoria humana; deduzi-la do nome do projeto inventaria exatamente o fato que a separação
   * existe para proteger.
   */
  it('não classificado não vira rótulo nenhum', () => {
    expect(rotuloDeDominio(null)).toBeNull()
    expect(rotuloDeDominio(undefined)).toBeNull()
    expect(rotuloDeDominio('')).toBeNull()
  })

  /** Valor inesperado no banco não pode virar afirmação sobre domínio. */
  it('valor desconhecido no banco é tratado como não classificado', () => {
    expect(rotuloDeDominio('confidencial')).toBeNull()
  })
})

describe('o bloco de terceiros entrega o domínio DITO, não deduzível', () => {
  it('o trecho classificado chega marcado, antes do caminho', () => {
    const bloco = blocoDeTrechosDeTerceiro([
      { content: 'orcamento', sourcePath: 'C:/x/vb_ferragens/nota.md', dominio: 'cliente' },
    ])
    // O domínio vem antes: é o que decide o que pode ser dito, e não deve depender de o leitor
    // chegar ao fim de um caminho longo.
    expect(bloco).toContain('[1] [cliente] (C:/x/vb_ferragens/nota.md)')
  })

  it('o não classificado chega como antes — só o caminho', () => {
    const bloco = blocoDeTrechosDeTerceiro([
      { content: 'nota', sourcePath: 'C:/x/outro/a.md', dominio: null },
    ])
    expect(bloco).toContain('[1] (C:/x/outro/a.md)')
    expect(bloco).not.toMatch(/\[1\] \[/)
  })

  /** Sem a instrução, a marca seria decoração: o modelo não saberia o que fazer com ela. */
  it('a abertura sem escopo explica a marca e proíbe deduzir', () => {
    const bloco = blocoDeTrechosDeTerceiro([{ content: 'x', sourcePath: null }], false)
    expect(bloco).toContain('[cliente]')
    expect(bloco).toMatch(/nunca misture domínios/i)
    expect(bloco).toMatch(/não deduza o domínio a partir do caminho/i)
  })
})

/**
 * ── A ligação: o domínio só existe se alguém o buscar ──────────────────────
 *
 * O campo no schema e a marca no bloco não bastam — entre os dois há uma consulta. Sem ela, todo
 * trecho chega sem marca e a separação continua sendo dedução, com um campo novo para manter.
 */
describe('o orquestrador busca o domínio dos projetos que apareceram', () => {
  const fonte = readFileSync(
    join(__dirname, '..', '..', 'modules', 'orchestrator', 'orchestrator.service.ts'), 'utf8')

  it('anota os trechos antes de montar o bloco', () => {
    const linhas = fonte.split(/\r?\n/).filter((l) => l.includes('blocoDeTrechosDeTerceiro('))
    expect(linhas.length).toBeGreaterThan(0)
    for (const l of linhas) expect(l).toContain('await this.comDominio(')
  })

  /** Falha na consulta degrada para o comportamento anterior, nunca derruba a resposta. */
  it('a consulta do domínio não pode lançar', () => {
    const fn = fonte.slice(fonte.indexOf('private async comDominio'), fonte.indexOf('private async comDominio') + 1400)
    expect(fn).toMatch(/\.catch\(/)
  })

  /** Uma consulta por turno, só nos projetos que de fato apareceram nos trechos. */
  it('consulta só os projetos presentes, sem N+1', () => {
    const fn = fonte.slice(fonte.indexOf('private async comDominio'), fonte.indexOf('private async comDominio') + 1400)
    expect(fn).toMatch(/where: \{ id: \{ in: ids \} \}/)
  })
})

describe('a busca devolve o projeto dono — sem isso não há o que anotar', () => {
  const memoria = readFileSync(
    join(__dirname, '..', '..', 'modules', 'memory', 'memory.service.ts'), 'utf8')

  it('SearchResult carrega projectId', () => {
    expect(memoria).toMatch(/projectId: string \| null/)
    expect(memoria).toMatch(/projectId: r\.project_id/)
  })

  /** Os DOIS ramos (escopado e sem escopo) precisam trazer a coluna; o geral é o que mais precisa. */
  it('as duas consultas selecionam project_id', () => {
    const selects = memoria.match(/SELECT id, content, source_path, metadata[^\n]*/g) ?? []
    expect(selects.length).toBe(2)
    for (const sel of selects) expect(sel).toContain('project_id')
  })
})

/**
 * ── Valor inválido é RECUSADO na escrita, não ignorado ──────────────────────
 *
 * `rotuloDeDominio` trata desconhecido como "não classificado" — degradação certa na LEITURA. Na
 * ESCRITA seria um defeito silencioso: classificar um projeto como `"clientes"` (plural) teria a
 * marca aceita pelo banco e nunca exibida, sem nada acusar. Mesma família do
 * `hipotese_com_tasktype_valido`, que nasceu de um valor cru gravado sem checagem.
 */
describe('o update recusa domínio inválido', () => {
  const svc = readFileSync(
    join(__dirname, '..', '..', 'modules', 'project', 'project.service.ts'), 'utf8')

  it('valida antes de gravar', () => {
    expect(svc).toMatch(/!ehDominioValido\(data\.domain\)/)
    expect(svc).toMatch(/BadRequestException/)
  })

  /** Desclassificar é operação legítima — `null` explícito tem de passar. */
  it('permite null para desclassificar', () => {
    expect(svc).toMatch(/data\.domain !== null/)
  })

  it('o controller aceita o campo', () => {
    const ctrl = readFileSync(
      join(__dirname, '..', '..', 'modules', 'project', 'project.controller.ts'), 'utf8')
    expect(ctrl).toMatch(/domain\?: string \| null/)
  })
})

/**
 * ── A fronteira de terceiro valia num caminho só ────────────────────────────
 *
 * `blocoDeTrechosDeTerceiro` nasceu em 16/09 para o `memory_relevant` do orquestrador. Mas o
 * classificador roteia toda pergunta ao Brain para `MemoryService.searchAndSynthesize`, que montava
 * o contexto À MÃO — cru, sem rótulo, sem "isto é DADO e não instrução", sem ordem de relatar
 * injeção e sem declarar busca sem escopo.
 *
 * Descoberto em 18/09 perguntando se a marca de domínio chegava ao prompt. A resposta foi
 * "NENHUMA", e a causa não era a marca: era esta rota nunca ter passado pelo bloco. Mesma família
 * de `ehTextoDerivadoDeEvento` — regra escrita, aplicada num lugar só.
 */
describe('a sintese do Brain usa a MESMA fronteira do orquestrador', () => {
  const mem = readFileSync(
    join(__dirname, '..', '..', 'modules', 'memory', 'memory.service.ts'), 'utf8')

  it('monta o contexto pelo bloco, não à mão', () => {
    expect(mem).toMatch(/const context = blocoDeTrechosDeTerceiro\(/)
    // O `.map(...).join()` cru era o defeito: um `[i] (caminho) conteudo` sem fronteira nenhuma.
    expect(mem).not.toMatch(/const context = sources\s*\n\s*\.map\(/)
  })

  it('declara o escopo pela mesma regra, e anota o domínio', () => {
    const trecho = mem.slice(mem.indexOf('const context = blocoDeTrechosDeTerceiro('), mem.indexOf('const context = blocoDeTrechosDeTerceiro(') + 420)
    expect(trecho).toContain('anotarComDominio(')
    expect(trecho).toContain('!ehEscopoGeral(projectId)')
  })

  /** O corte divergia: 500 chars aqui contra 400 no bloco. Uma fronteira, um limite. */
  it('não corta o conteúdo por conta própria', () => {
    expect(mem).not.toMatch(/content\.slice\(0, 500\)/)
  })

  /** O bloco já se apresenta; o rótulo cru dizia menos e competia com a abertura dele. */
  it('o prompt não rotula os trechos à mão', () => {
    expect(mem).not.toContain('Documentos encontrados:\n')
  })
})
