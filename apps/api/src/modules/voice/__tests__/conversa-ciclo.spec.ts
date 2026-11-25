/**
 * HC7b: a regra do modo conversa mora na web (`apps/web/app/hooks/conversaCiclo.ts`), que não tem
 * suíte própria: o `qa:ingest` do CI passa argumentos do jest a todo app com `test`, e roda em
 * Node 20. O arquivo não importa nada, então é testado daqui, ao lado da fala em pedaços (HC7a).
 *
 * Lido como texto e transpilado aqui, porque o `tsc` da api não aceita importar arquivo de fora do
 * `rootDir`. É o mesmo recurso de `planning-merge.spec.ts` no agent: o teste executa o código que
 * roda, não uma cópia. Os tipos abaixo são só os que o teste usa.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as ts from 'typescript'

type EstadoDaConversa = { fase: string; iniciadaEm: number | null; escutasVazias: number; motivoDaSaida: string | null }
type EventoDaConversa = { tipo: string; agora?: number; texto?: string; cartoesNovos?: number }
type EfeitoDaConversa = { tipo: string; qual?: string; texto?: string; ligar?: boolean }
interface Ciclo {
  passoDaConversa: (e: EstadoDaConversa, ev: EventoDaConversa) => { estado: EstadoDaConversa; efeitos: EfeitoDaConversa[] }
  CONVERSA_DESLIGADA: EstadoDaConversa
  DURACAO_MAXIMA_MS: number
  AVISO_DE_CARTAO: string
  AVISO_DE_FALHA: string
}

function carregarCiclo(): Ciclo {
  const caminho = join(__dirname, '..', '..', '..', '..', '..', 'web', 'app', 'hooks', 'conversaCiclo.ts')
  const js = ts.transpileModule(readFileSync(caminho, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const modulo = { exports: {} as Ciclo }
  new Function('module', 'exports', js)(modulo, modulo.exports)
  return modulo.exports
}

const { passoDaConversa, CONVERSA_DESLIGADA, DURACAO_MAXIMA_MS, AVISO_DE_CARTAO, AVISO_DE_FALHA } = carregarCiclo()

/** Aplica uma sequência de eventos e devolve o estado final e todos os efeitos, na ordem. */
function rodar(eventos: EventoDaConversa[], inicio: EstadoDaConversa = CONVERSA_DESLIGADA) {
  let estado = inicio
  const efeitos: EfeitoDaConversa[] = []
  for (const e of eventos) {
    const p = passoDaConversa(estado, e)
    estado = p.estado
    efeitos.push(...p.efeitos)
  }
  return { estado, efeitos }
}

const tipos = (efeitos: EfeitoDaConversa[]) => efeitos.map((e) => e.tipo)

describe('modo conversa (HC7b)', () => {
  it('uma volta completa: ouvir, transcrever, enviar sem revisão, falar, voltar a ouvir', () => {
    const { estado, efeitos } = rodar([
      { tipo: 'ligar', agora: 0 },
      { tipo: 'falaFechada' },
      { tipo: 'transcrito', texto: '  explica o capítulo dois  ' },
      { tipo: 'resposta', texto: 'O capítulo dois trata de webhooks.', cartoesNovos: 0 },
      { tipo: 'falaTerminou', agora: 60_000 },
    ])
    assert.equal(estado.fase, 'ouvindo')
    assert.deepEqual(efeitos, [
      { tipo: 'telaAcesa', ligar: true },
      { tipo: 'abrirMicrofone' },
      { tipo: 'tom', qual: 'ouvi' },
      { tipo: 'enviar', texto: 'explica o capítulo dois' },
      { tipo: 'falar', texto: 'O capítulo dois trata de webhooks.' },
      { tipo: 'abrirMicrofone' },
    ])
  })

  it('não abre o microfone enquanto pensa nem enquanto fala', () => {
    const { efeitos } = rodar([
      { tipo: 'ligar', agora: 0 },
      { tipo: 'falaFechada' },
      { tipo: 'transcrito', texto: 'oi' },
      { tipo: 'resposta', texto: 'olá', cartoesNovos: 0 },
    ])
    // Um abrirMicrofone só, o da ligada: depois dele, nenhum até a fala terminar.
    assert.equal(tipos(efeitos).filter((t) => t === 'abrirMicrofone').length, 1)
  })

  it('duas escutas seguidas sem fala desligam, com o tom de saída', () => {
    const uma = rodar([{ tipo: 'ligar', agora: 0 }, { tipo: 'semFala' }])
    assert.equal(uma.estado.fase, 'ouvindo')
    assert.equal(uma.estado.escutasVazias, 1)

    const duas = rodar([{ tipo: 'semFala' }], uma.estado)
    assert.equal(duas.estado.fase, 'desligada')
    assert.equal(duas.estado.motivoDaSaida, 'silencio')
    assert.ok(duas.efeitos.some((e) => e.tipo === 'tom' && e.qual === 'saida'))
    assert.ok(duas.efeitos.some((e) => e.tipo === 'telaAcesa' && !e.ligar))
  })

  it('transcrição vazia conta como escuta vazia e não envia nada', () => {
    const { estado, efeitos } = rodar([
      { tipo: 'ligar', agora: 0 },
      { tipo: 'falaFechada' },
      { tipo: 'transcrito', texto: '   ' },
    ])
    assert.equal(estado.fase, 'ouvindo')
    assert.equal(estado.escutasVazias, 1)
    assert.ok(!tipos(efeitos).includes('enviar'))
  })

  it('uma fala de verdade zera a contagem de escutas vazias', () => {
    const { estado } = rodar([
      { tipo: 'ligar', agora: 0 },
      { tipo: 'semFala' },
      { tipo: 'falaFechada' },
      { tipo: 'transcrito', texto: 'continua' },
      { tipo: 'resposta', texto: 'ok', cartoesNovos: 0 },
      { tipo: 'falaTerminou', agora: 1 },
      { tipo: 'semFala' },
    ])
    // Sem o zerar, esta seria a segunda vazia e teria desligado.
    assert.equal(estado.fase, 'ouvindo')
    assert.equal(estado.escutasVazias, 1)
  })

  it('cartão novo vira aviso falado no fim da resposta', () => {
    const { efeitos } = rodar([
      { tipo: 'ligar', agora: 0 },
      { tipo: 'falaFechada' },
      { tipo: 'transcrito', texto: 'guarda isso na memória' },
      { tipo: 'resposta', texto: 'Propus guardar.', cartoesNovos: 1 },
    ])
    const falar = efeitos.find((e) => e.tipo === 'falar')
    assert.ok(falar?.texto?.endsWith(AVISO_DE_CARTAO))
  })

  it('sem cartão novo, a resposta é falada como veio', () => {
    const { efeitos } = rodar([
      { tipo: 'ligar', agora: 0 }, { tipo: 'falaFechada' }, { tipo: 'transcrito', texto: 'a' },
      { tipo: 'resposta', texto: 'b', cartoesNovos: 0 },
    ])
    assert.deepEqual(efeitos.at(-1), { tipo: 'falar', texto: 'b' })
  })

  it('falha do turno é dita em voz e a conversa segue', () => {
    const { estado, efeitos } = rodar([
      { tipo: 'ligar', agora: 0 }, { tipo: 'falaFechada' }, { tipo: 'transcrito', texto: 'a' },
      { tipo: 'respostaFalhou' },
      { tipo: 'falaTerminou', agora: 1 },
    ])
    assert.ok(efeitos.some((e) => e.tipo === 'falar' && e.texto === AVISO_DE_FALHA))
    assert.equal(estado.fase, 'ouvindo')
  })

  it('tocar durante a fala para a voz e volta a ouvir', () => {
    const falando = rodar([
      { tipo: 'ligar', agora: 0 }, { tipo: 'falaFechada' }, { tipo: 'transcrito', texto: 'a' },
      { tipo: 'resposta', texto: 'resposta longa', cartoesNovos: 0 },
    ]).estado
    const { estado, efeitos } = rodar([{ tipo: 'toque' }], falando)
    assert.equal(estado.fase, 'ouvindo')
    assert.deepEqual(efeitos, [{ tipo: 'pararFala' }, { tipo: 'abrirMicrofone' }])

    // A fala parada ainda avisa que terminou: isso não pode abrir o microfone uma segunda vez.
    const depois = rodar([{ tipo: 'falaTerminou', agora: 2 }], estado)
    assert.deepEqual(depois.efeitos, [])
  })

  it('tocar enquanto pensa não faz nada (a pergunta já foi)', () => {
    const pensando = rodar([
      { tipo: 'ligar', agora: 0 }, { tipo: 'falaFechada' }, { tipo: 'transcrito', texto: 'a' },
    ]).estado
    assert.deepEqual(passoDaConversa(pensando, { tipo: 'toque' }), { estado: pensando, efeitos: [] })
  })

  it('tela apagada ou aba trocada desliga de qualquer fase', () => {
    for (const ate of [1, 2, 3, 4]) {
      const eventos: EventoDaConversa[] = [
        { tipo: 'ligar', agora: 0 }, { tipo: 'falaFechada' }, { tipo: 'transcrito', texto: 'a' },
        { tipo: 'resposta', texto: 'b', cartoesNovos: 0 },
      ].slice(0, ate)
      const { estado } = rodar([...eventos, { tipo: 'telaOculta' }])
      assert.equal(estado.fase, 'desligada', `depois de ${ate} evento(s)`)
      assert.equal(estado.motivoDaSaida, 'tela')
    }
  })

  it('passados 30 minutos, sai ao terminar de falar, não no meio da resposta', () => {
    const falando = rodar([
      { tipo: 'ligar', agora: 0 }, { tipo: 'falaFechada' }, { tipo: 'transcrito', texto: 'a' },
      { tipo: 'resposta', texto: 'b', cartoesNovos: 0 },
    ]).estado
    const antes = rodar([{ tipo: 'falaTerminou', agora: DURACAO_MAXIMA_MS - 1 }], falando)
    assert.equal(antes.estado.fase, 'ouvindo')
    const depois = rodar([{ tipo: 'falaTerminou', agora: DURACAO_MAXIMA_MS }], falando)
    assert.equal(depois.estado.fase, 'desligada')
    assert.equal(depois.estado.motivoDaSaida, 'tempo')
  })

  it('sair pelo botão não toca o tom de saída', () => {
    const { estado, efeitos } = rodar([{ tipo: 'ligar', agora: 0 }, { tipo: 'desligar' }])
    assert.equal(estado.motivoDaSaida, 'manual')
    assert.ok(!efeitos.some((e) => e.tipo === 'tom' && e.qual === 'saida'))
    assert.ok(efeitos.some((e) => e.tipo === 'fecharMicrofone'))
  })

  it('resposta que chega com o modo desligado, ou fora de "pensando", não é falada', () => {
    assert.deepEqual(passoDaConversa(CONVERSA_DESLIGADA, { tipo: 'resposta', texto: 'x', cartoesNovos: 0 }).efeitos, [])
    const ouvindo = rodar([{ tipo: 'ligar', agora: 0 }]).estado
    assert.deepEqual(passoDaConversa(ouvindo, { tipo: 'resposta', texto: 'x', cartoesNovos: 0 }).efeitos, [])
  })

  it('erro do microfone desliga', () => {
    const { estado } = rodar([{ tipo: 'ligar', agora: 0 }, { tipo: 'erroDoMicrofone' }])
    assert.equal(estado.motivoDaSaida, 'microfone')
  })

  it('ligar duas vezes não reinicia o relógio dos 30 minutos', () => {
    const { estado } = rodar([{ tipo: 'ligar', agora: 0 }, { tipo: 'ligar', agora: 999 }])
    assert.equal(estado.iniciadaEm, 0)
  })
})
