import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * ── H2: o contrato da ferramenta é o que decide a FONTE ──────────────────────
 *
 * Medido em 13/09 contra o Hermes, com o MCP de leitura conectado:
 *
 *  - perguntado "qual o objetivo do projeto X", ele respondeu com o campo `description` de
 *    `rayzen_list_projects` — texto de CADASTRO, escrito uma vez na criação — em vez do
 *    objetivo vigente de `rayzen_get_state`. O projeto estava certo; a fonte, não. E a
 *    descrição do próprio Rayzen AI dizia "entre VPS e máquina local", **desatualizada desde
 *    09/08**, quando o servidor deixou de ser VPS. Informação obsoleta servida como estado
 *    atual — o modo de falha que esta casa inteira existe para evitar.
 *
 * O modelo não errou por burrice: a descrição da tool não dizia que `description` é cadastro,
 * e o payload trazia o campo. **Contrato incompleto é ambiguidade, e ambiguidade o modelo
 * resolve sozinho** — do jeito dele.
 *
 * O outro contrato coberto aqui é o de EFEITO: `rayzen_get_context` está no token de leitura e
 * não grava fato nenhum, mas a cadeia `POST /v2/context/build → ContextEngine →
 * MemoryService.search → trackAccess` incrementa `accessCount` e promove `inbox → working` a
 * partir de 3 acessos. "Readonly na lista de ferramentas" não é "consulta sem efeitos internos",
 * e quem chama precisa saber disso para escolher.
 *
 * Lidos como TEXTO, e os dois arquivos: as definições de tool são duplicadas entre o MCP stdio
 * (o que a sessão do Claude Code usa) e o HTTP (o que o Hermes usa). Duas cópias divergem em
 * silêncio — mesma família de `memory-ranking.const.ts` e `event-derived-text.const.ts`.
 */
const MCP_DIR = join(__dirname, '..')
const ARQUIVOS = ['rayzen-mcp.mjs', 'rayzen-mcp-http.mjs'] as const

function ler(arquivo: string): string {
  return readFileSync(join(MCP_DIR, arquivo), 'utf8')
}

describe('contrato das tools de leitura — fonte certa e efeito declarado', () => {
  describe.each(ARQUIVOS)('%s', (arquivo) => {
    const fonte = ler(arquivo)

    it('rayzen_list_projects avisa que `description` é cadastro, não estado', () => {
      expect(fonte).toMatch(/`description` é texto de cadastro/)
    })

    it('...e aponta para onde está o estado vigente', () => {
      expect(fonte).toMatch(/rayzen_get_state \(vigente\)/)
    })

    it('rayzen_get_context declara que registra acesso e pode promover classe', () => {
      expect(fonte).toMatch(/NOTA DE EFEITO/)
      expect(fonte).toMatch(/inbox → working/)
    })

    it('...e nomeia a alternativa sem efeito', () => {
      expect(fonte).toMatch(/use rayzen_search_memory/)
    })
  })

  /**
   * A nota de efeito indica `rayzen_search_memory` como a consulta sem contabilização — e isso
   * só é verdade porque ela bate no Brain **V1** (`/brain/search`), fora do `trackAccess`, que
   * é da memória V2. Migrar essa tool para a V2 transformaria a recomendação em mentira, sem
   * nada acusar. Este teste é o que segura a promessa.
   */
  describe.each(ARQUIVOS)('%s — a alternativa sem efeito continua sendo sem efeito', (arquivo) => {
    it('rayzen_search_memory usa o Brain V1, não o context/memory da V2', () => {
      const fonte = ler(arquivo)
      const trecho = fonte.slice(fonte.indexOf("case 'rayzen_search_memory'"))
      const corpo = trecho.slice(0, trecho.indexOf('break'))

      expect(corpo).toMatch(/\/brain\/search/)
      expect(corpo).not.toMatch(/apiV2|\/v2\//)
    })
  })
})
