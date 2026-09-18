/**
 * Em 2026-09-05 o disco do H81 estava em **82%** — 85 GB de 110 GB, 20 GB livres — e o
 * dono relatou que já tinha acontecido antes.
 *
 * A causa não era dado do Rayzen: os dois bancos somam **417 MB**. Era o build cache do
 * Docker, **54,44 GB** dos quais 54,37 GB recuperáveis, alimentado por todo push em `main`
 * que dispara `docker compose up -d --build`. Um `builder prune` devolveu **49,2 GB** e
 * levou o disco de 82% para 39%.
 *
 * Nada acusava. Disco enche em silêncio e só se manifesta quando um build falha ou o
 * Postgres para de escrever — as duas coisas tarde demais. É o critério de entrada da
 * lista: já quebrou calado e custou tempo.
 */

describe('disco_com_folga', () => {
  function build(totalGb: number, livreGb: number, erro?: Error) {
    jest.resetModules()
    const bsize = 4096
    const gbEmBlocos = (gb: number) => (gb * 1024 ** 3) / bsize
    jest.doMock('node:fs/promises', () => ({
      statfs: erro
        ? jest.fn().mockRejectedValue(erro)
        : jest.fn().mockResolvedValue({ bsize, blocks: gbEmBlocos(totalGb), bavail: gbEmBlocos(livreGb) }),
    }))
    jest.doMock('node:fs', () => ({ existsSync: () => false, readdirSync: () => [] }))

    const { InvariantsService } = require('../invariants.service') as typeof import('../invariants.service')
    const service = new InvariantsService({} as never, {} as never, {} as never, {} as never)
    return () => (service as unknown as {
      discoComFolga: () => Promise<{ ok: boolean; detalhe: string; correcao?: string }>
    }).discoComFolga()
  }

  afterEach(() => { jest.dontMock('node:fs/promises'); jest.dontMock('node:fs') })

  it('verde com folga — o estado depois da limpeza de 05/09', async () => {
    const r = await build(110, 65)()   // 39% usado
    expect(r.ok).toBe(true)
    expect(r.detalhe).toContain('41% usado')
  })

  it('vermelho no estado que motivou o check — 82% não passaria', async () => {
    // 82% real de 05/09 fica ABAIXO do limiar de 85%, e isso é deliberado: o check avisa
    // antes de doer, não no momento em que já dói. Este caso usa 88% para exercitar a
    // falha; o teste seguinte cobre a fronteira.
    const r = await build(110, 13)()   // ~88% usado
    expect(r.ok).toBe(false)
    expect(r.detalhe).toContain('limiar 85%')
  })

  it('a correção aponta o build cache, não o banco — foi o erro de diagnóstico da primeira vez', async () => {
    const r = await build(110, 5)()
    expect(r.correcao).toMatch(/build cache/i)
    expect(r.correcao).toMatch(/builder prune/)
    expect(r.correcao).toMatch(/417 MB/)   // a comparação que evita culpar o Postgres
  })

  it('84% ainda é verde e 86% já é vermelho — a fronteira é onde está declarada', async () => {
    expect((await build(100, 16)()).ok).toBe(true)    // 84%
    expect((await build(100, 14)()).ok).toBe(false)   // 86%
  })

  it('filesystem que não responde é INCONCLUSIVO, não falha', async () => {
    const r = await build(0, 0, new Error('EACCES'))()
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/Inconclusivo/)
  })

  it('tamanho zero não vira divisão por zero nem 100% falso', async () => {
    const r = await build(0, 0)()
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/Inconclusivo/)
  })

  it('o detalhe traz o número medido mesmo quando está tudo bem', async () => {
    // Um check que só fala quando falha não deixa acompanhar tendência. Aqui o número
    // aparece sempre — é ele que mostra o disco subindo antes de cruzar o limiar.
    const r = await build(110, 65)()
    expect(r.detalhe).toMatch(/GB livres de/)
  })
})

/**
 * ── O aviso repetido que não foi ouvido (16/09) ──────────────────────────────
 *
 * O sensor avisou em 85, 86, 88, 90, 92 e **95%** ao longo do dia. Todos os avisos diziam a
 * mesma coisa — um número e um limiar — então cada um foi lido como o anterior e tratado como
 * ruído conhecido. Nenhum dizia **o que acontece quando chega a 100**.
 *
 * Chegou. O Postgres entrou em laço de `PANIC: could not write to file
 * pg_logical/replorigin_checkpoint.tmp: No space left on device`, sem espaço nem para terminar a
 * própria recuperação, e a plataforma ficou fora do ar.
 *
 * E o `correcao` do próprio check ensinava o comando errado: `--keep-storage 10GB` é o MÍNIMO que
 * a poda preserva, não o teto do cache. Seguir a correção liberava pouco e **confirmava** a
 * leitura equivocada de que não havia mais o que liberar. Um `prune -af` recuperou 66,95 GB.
 *
 * O sensor funcionou; o que falhou foi o texto. Não há gravidade nova — `alta` já é o teto, e um
 * quarto nível rippliaria pelo sistema para codificar uma faixa.
 */
describe('disco_com_folga — a faixa crítica fala de consequência, não de número', () => {
  function build(totalGb: number, livreGb: number) {
    jest.resetModules()
    const bsize = 4096
    const gbEmBlocos = (gb: number) => (gb * 1024 ** 3) / bsize
    jest.doMock('node:fs/promises', () => ({
      statfs: jest.fn().mockResolvedValue({ bsize, blocks: gbEmBlocos(totalGb), bavail: gbEmBlocos(livreGb) }),
    }))
    jest.doMock('node:fs', () => ({ existsSync: () => false, readdirSync: () => [] }))
    const { InvariantsService } = require('../invariants.service') as typeof import('../invariants.service')
    const service = new InvariantsService({} as never, {} as never, {} as never, {} as never)
    return () => (service as unknown as {
      discoComFolga: () => Promise<{ ok: boolean; detalhe: string; correcao?: string }>
    }).discoComFolga()
  }

  afterEach(() => { jest.dontMock('node:fs/promises'); jest.dontMock('node:fs') })

  it('87% avisa, mas sem o texto crítico — ainda dá para agir sem pressa', async () => {
    const r = await build(110, 14)()
    expect(r.ok).toBe(false)
    expect(r.detalhe).not.toMatch(/CRÍTICO/)
  })

  it('95% diz o que vai quebrar, não só o número', async () => {
    const r = await build(110, 5)()
    expect(r.ok).toBe(false)
    expect(r.detalhe).toMatch(/CRÍTICO/)
    expect(r.detalhe).toMatch(/Postgres/)
    expect(r.detalhe).toMatch(/PANIC|No space left on device/)
  })

  it('a correção manda `prune -af` e avisa sobre a flag que engana', async () => {
    const r = await build(110, 5)()
    expect(r.correcao).toMatch(/prune -af/)
    expect(r.correcao).toMatch(/M[ÍI]NIMO que a poda preserva/i)
  })

  /** A correção errada não pode sobreviver em faixa nenhuma — foi ela que confirmou o engano. */
  it('nem a faixa de aviso ensina --keep-storage', async () => {
    for (const livre of [14, 5]) {
      const r = await build(110, livre)()
      expect(r.correcao).not.toMatch(/recuperar com `docker builder prune -f --keep-storage/)
    }
  })
})
