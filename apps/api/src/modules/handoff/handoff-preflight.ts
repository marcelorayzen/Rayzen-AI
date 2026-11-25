import { posix } from 'path'

/**
 * O que a prévia encontrou, e o que isso autoriza.
 *
 * ── Por que a checagem roda no agent, e não aqui ────────────────────────────
 * A regra de safe root mora em `apps/agent/src/utils/path-guard.ts`, e o disco é o da máquina
 * de trabalho. Copiar a regra para a API daria a quinta cópia de uma norma que já divergiu
 * quatro vezes nesta casa — foram quatro `SAFE_ROOTS` ad-hoc, e três delas sem fronteira de
 * diretório (`C:\ProjectsEvil` passava). A prévia pergunta a quem é dono da regra, no lugar
 * onde o disco existe.
 *
 * O custo declarado: a recusa por raiz inválida acontece depois da aprovação, não antes dela.
 * Ninguém executa nada, mas alguém pode ter aprovado um envelope que nunca rodaria. Antecipar
 * isso exigiria a cópia acima, e a troca não compensa.
 */

/**
 * Retrato do git medido pelo agent. Três estados, e o terceiro é o que costuma ser perdido:
 * `inconclusivo` diz que não deu para medir, e não pode ser lido como "não é repositório".
 */
export interface RetratoDoGit {
  estado: 'repo' | 'nao-repo' | 'inconclusivo'
  medidoEm?: string
  raiz?: string | null
  branch?: string | null
  head?: string | null
  naoCommitados?: number | null
  motivo?: string
}

export interface PreviaDoEfeito {
  pastaJaExiste?: boolean
  acao?: 'criar' | 'reconciliar'
  projetoJaRegistrado?: { id: string; checkoutPath: string | null } | null
  vaiRodarGitInitCommit?: boolean
  vaiAbrirVscode?: boolean
  template?: string
  subpastas?: string[]
  git?: RetratoDoGit
}

export interface ResultadoDaPrevia {
  path?: string
  previa?: PreviaDoEfeito
}

export type VeredictoDaPrevia =
  | { ok: true; motivo: string }
  | { ok: false; motivo: string }

/**
 * Decide se o efeito pode seguir para a fila.
 *
 * ── O caso que isto existe para pegar ───────────────────────────────────────
 * O projeto já está registrado com um checkout em OUTRO lugar. Materializar assim criaria uma
 * segunda pasta para um projeto que já tem uma, e o catálogo passaria a apontar para uma das
 * duas — exatamente o "repetição duplica pasta ou registro" que a fase existe para impedir,
 * só que por um caminho que a chave de idempotência não cobre (envelopes diferentes, mesmo
 * projeto).
 *
 * Pasta existente **não** é impedimento: a ação reconcilia sem reescrever arquivo nenhum, e
 * recusar aqui tornaria impossível retomar um projeto — que é metade do que a Fase 4 promete
 * ("materializar ou RETOMAR o trabalho").
 */
export function avaliarPrevia(
  resultado: ResultadoDaPrevia | null | undefined,
  rootDoEnvelope: string,
): VeredictoDaPrevia {
  const previa = resultado?.previa
  if (!previa) {
    // Sem prévia não se sabe o que existe do outro lado. Seguir seria executar às cegas
    // justamente no passo que a fase pede para ser verificado antes.
    return { ok: false, motivo: 'a prévia não respondeu — não dá para reconciliar às cegas' }
  }

  if (!resultado?.path || !dentroDaRaiz(resultado.path, rootDoEnvelope)) {
    return { ok: false, motivo: 'a prévia não confirmou um caminho dentro da raiz do envelope' }
  }

  const registrado = previa.projetoJaRegistrado
  if (registrado?.checkoutPath && !mesmoCaminho(registrado.checkoutPath, resultado.path)) {
    return {
      ok: false,
      motivo: `o projeto ${registrado.id} já tem checkout em "${registrado.checkoutPath}" — `
        + 'materializar aqui criaria uma segunda pasta para o mesmo projeto',
    }
  }

  // ── Git bloqueia só o que o efeito danificaria ─────────────────────────────
  //
  // Trabalho não commitado NÃO bloqueia: o caminho de reconciliar não roda git nem reescreve
  // arquivo, então não há o que destruir — e bloquear impediria retomar um projeto, que
  // normalmente se retoma justamente porque tem trabalho em andamento.
  //
  // Branch NÃO bloqueia: o envelope não declara branch esperada, e recusar por ela seria
  // inventar um campo que ninguém definiu.
  //
  // O que bloqueia é um caso só: criar dentro de um repositório existente. O `git init` do
  // template criaria um repositório ANINHADO, e aí o estado do git não é contexto — ele torna
  // o efeito errado.
  if (previa.vaiRodarGitInitCommit && previa.git?.estado === 'repo') {
    return {
      ok: false,
      motivo: `a raiz já está dentro do repositório "${previa.git.raiz ?? 'desconhecido'}" — `
        + 'o git init do template criaria um repositório aninhado',
    }
  }

  if (previa.acao === 'reconciliar') {
    return { ok: true, motivo: `pasta já existe: a execução vai reconciliar, sem reescrever arquivo${notaDeGit(previa.git)}` }
  }
  return { ok: true, motivo: `pasta não existe: a execução vai criar${notaDeGit(previa.git)}` }
}

/** O git entra no motivo como REGISTRO — inclusive quando não deu para medir. */
function notaDeGit(git?: RetratoDoGit): string {
  if (!git) return ''
  if (git.estado === 'inconclusivo') return ' · git: não foi possível medir'
  if (git.estado === 'nao-repo') return ' · git: não é repositório'
  const pendentes = typeof git.naoCommitados === 'number' ? `, ${git.naoCommitados} não commitado(s)` : ''
  return ` · git: repo em ${git.branch ?? 'branch desconhecida'}${pendentes}`
}

/** Barra invertida e barra normal são o mesmo caminho no Windows; caixa também não separa. */
function mesmoCaminho(a: string, b: string): boolean {
  return normalizarCaminho(a) === normalizarCaminho(b)
}

function normalizarCaminho(s: string): string {
  return posix.normalize(s.replace(/[/\\]+/g, '/')).replace(/\/+$/, '').toLowerCase()
}

function dentroDaRaiz(caminho: string, root: string): boolean {
  return normalizarCaminho(caminho).startsWith(`${normalizarCaminho(root)}/`)
}

/**
 * Depois da execucao: o efeito esta mesmo la?
 *
 * ── Tres desfechos, nao dois ────────────────────────────────────────────────
 * `confirmado` fecha o envelope. `ausente` significa que a tarefa relatou `done` e o efeito
 * nao aparece — nao e falha comum, e incerteza: alguem precisa olhar, e o envelope vai para
 * `effect_unknown`. E `nao-verificado` e quando a propria verificacao nao completou (agent
 * fora, timeout): ai nada se afirma e a proxima varredura tenta de novo.
 *
 * Colapsar o terceiro no segundo seria declarar efeito ausente por nao ter conseguido olhar —
 * o mesmo erro que `historico_serve_conversa` evita ao chamar de INCONCLUSIVO a falha de
 * sondagem, em vez de culpar o alvo.
 */
export type VerificacaoDoEfeito =
  | { estado: 'confirmado'; motivo: string }
  | { estado: 'ausente'; motivo: string }
  | { estado: 'nao-verificado'; motivo: string }

/**
 * O que mudou no git entre a prévia e a verificação.
 *
 * É **evidência, não bloqueio**. Um branch diferente ou arquivos novos no destino podem ser
 * perfeitamente legítimos — alguém trabalhou ali entre uma medição e outra é o caso comum de
 * um projeto retomado. O que não pode acontecer é a divergência passar despercebida.
 *
 * `inconclusivo` de um dos lados não é divergência: comparar com uma medição que não aconteceu
 * produziria alarme a partir de ausência de informação.
 */
export function compararGit(antes?: RetratoDoGit, depois?: RetratoDoGit): string | null {
  if (!antes || !depois) return null
  if (antes.estado === 'inconclusivo' || depois.estado === 'inconclusivo') return null

  const mudancas: string[] = []
  if (antes.estado !== depois.estado) mudancas.push(`estado ${antes.estado} para ${depois.estado}`)
  if (antes.estado === 'repo' && depois.estado === 'repo') {
    if (antes.branch !== depois.branch) mudancas.push(`branch ${antes.branch ?? '?'} para ${depois.branch ?? '?'}`)
    if (antes.head !== depois.head) mudancas.push(`HEAD ${(antes.head ?? '?').slice(0, 8)} para ${(depois.head ?? '?').slice(0, 8)}`)
    if (antes.naoCommitados !== depois.naoCommitados) {
      mudancas.push(`não commitados ${antes.naoCommitados ?? '?'} para ${depois.naoCommitados ?? '?'}`)
    }
  }
  return mudancas.length ? `git mudou: ${mudancas.join('; ')}` : null
}

export function verificarEfeito(
  resultado: ResultadoDaPrevia | null | undefined,
  gitAntes?: RetratoDoGit,
  caminhoAprovado?: string,
): VerificacaoDoEfeito {
  const previa = resultado?.previa
  if (!previa || !resultado?.path) {
    return { estado: 'nao-verificado', motivo: 'a verificacao nao respondeu — nada a afirmar' }
  }
  if (caminhoAprovado && !mesmoCaminho(resultado.path, caminhoAprovado)) {
    return { estado: 'ausente', motivo: 'o postflight mediu outro caminho, diferente do preflight aprovado' }
  }
  const divergencia = compararGit(gitAntes, previa.git)

  // A previa roda DEPOIS da execucao: a pasta tem de existir agora, e por isso a acao prevista
  // para uma nova chamada seria `reconciliar`, nao `criar`.
  if (previa.pastaJaExiste !== true) {
    return {
      estado: 'ausente',
      motivo: 'a tarefa relatou conclusao, mas a pasta nao existe no disco',
    }
  }
  if (!previa.projetoJaRegistrado) {
    return {
      estado: 'ausente',
      motivo: 'a pasta existe, mas o projeto nao esta no catalogo — efeito pela metade',
    }
  }
  if (!previa.projetoJaRegistrado.checkoutPath
      || !mesmoCaminho(previa.projetoJaRegistrado.checkoutPath, resultado.path)) {
    return {
      estado: 'ausente',
      motivo: 'a pasta existe, mas o catalogo nao aponta para esse checkout — efeito pela metade',
    }
  }
  return {
    estado: 'confirmado',
    // A divergência do git acompanha a confirmação em vez de impedi-la: ela é registro do que
    // mudou entre as duas medições, não motivo para recusar um efeito que está lá.
    motivo: `pasta no disco e projeto ${previa.projetoJaRegistrado.id} no catalogo`
      + (divergencia ? ` · ${divergencia}` : ''),
  }
}

// ── supervised_session (item 7.2a, fatia B) ─────────────────────────────────
//
// Mesma forma do par avaliarPrevia/verificarEfeito, com outro MUNDO a medir: em vez de pasta e
// catálogo, repositório, remoto, `gh` e — depois — o branch da sessão no remoto e o PR. A
// prévia é produzida por `apps/agent/src/actions/previa-da-sessao.ts`, que só lê.

export interface EntregaMedidaDaSessao {
  commitLocal: string | null
  commitNoRemoto: string | null
  prUrl: string | null
  prEstado: string | null
  prRascunho: boolean | null
  inconclusiva: boolean
}

export interface PreviaDaSessao {
  tipo: 'sessao_supervisionada'
  branch: string
  publicar: boolean
  git?: RetratoDoGit
  remoto: string | null
  ghAutenticado: boolean | null
  entrega: EntregaMedidaDaSessao
  /** S3 (16/11): `sandbox` quando a sessão roda no servidor; o `path` é então `sandbox://dono/repo`. */
  regime?: 'sandbox'
  /** G3.2 (24/11): continuação de uma sessão interrompida, medida na pasta e no ramo dela. */
  retomada?: boolean
}

/** O único "caminho" que uma prévia da sandbox pode declarar: dono e repositório do GitHub. */
const CAMINHO_DA_SANDBOX = /^sandbox:\/\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface ResultadoDaPreviaDaSessao {
  ok?: boolean
  error?: string
  path?: string
  previa?: PreviaDaSessao
}

/** O registro durável do que foi entregue — gravado SÓ a partir do postflight medido. */
export interface EntregaDoHandoff {
  branch: string
  commit: string
  publicado: boolean
  remoto: string | null
  prUrl: string | null
  prEstado: string | null
  prRascunho: boolean | null
  medidoEm: string
}

export function avaliarPreviaDaSessao(
  resultado: ResultadoDaPreviaDaSessao | null | undefined,
  rootDoEnvelope: string,
): VeredictoDaPrevia {
  const previa = resultado?.previa
  if (!previa || previa.tipo !== 'sessao_supervisionada') {
    return {
      ok: false,
      motivo: resultado?.error
        ? `a prévia recusou: ${resultado.error}`
        : 'a prévia da sessão não respondeu — não dá para enfileirar às cegas',
    }
  }
  if (previa.regime === 'sandbox') {
    // Na sandbox não há pasta no host: o confinamento é o container, e o clone vem do GitHub.
    // O `path` precisa ter a forma exata — e só vale com o regime declarado, nunca o contrário.
    if (!resultado?.path || !CAMINHO_DA_SANDBOX.test(resultado.path)) {
      return { ok: false, motivo: 'a prévia da sandbox não declarou dono/repositório válidos' }
    }
    if (!previa.publicar) {
      return { ok: false, motivo: 'na sandbox a entrega é sempre PR — o envelope precisa de publicar' }
    }
  } else if (!resultado?.path || !dentroDaRaiz(resultado.path, rootDoEnvelope)) {
    return { ok: false, motivo: 'a prévia não confirmou um checkout dentro da raiz do envelope' }
  }
  // A sessão isola por worktree; fora de repositório ela rodaria no diretório real.
  if (previa.git?.estado !== 'repo') {
    return { ok: false, motivo: 'o checkout do projeto não é um repositório git — a sessão não teria worktree isolado' }
  }
  if (previa.retomada === true) {
    // G3.2: numa continuação a regra se inverte — o ramo TEM de existir aqui (é o trabalho salvo)
    // e NÃO pode estar no remoto (publicar já teria acontecido, e isso pede uma pessoa olhando).
    // Não ter conseguido perguntar ao remoto não é o remoto dizer que não tem.
    if (previa.regime !== 'sandbox') {
      return { ok: false, motivo: 'retomar uma sessão interrompida só funciona na sandbox do servidor' }
    }
    if (!previa.entrega.commitLocal) {
      return { ok: false, motivo: `o ramo ${previa.branch} não existe na pasta da sessão: não há trabalho salvo para retomar` }
    }
    if (previa.entrega.inconclusiva) {
      return { ok: false, motivo: 'não deu para consultar o GitHub: sem medir, não se afirma que nada foi publicado' }
    }
    if (previa.entrega.commitNoRemoto) {
      return { ok: false, motivo: `o ramo ${previa.branch} já está no GitHub: confira antes; retomar não é o caminho` }
    }
  } else if (previa.entrega.commitLocal || previa.entrega.commitNoRemoto) {
    // Um branch de sessão que já existe antes de a sessão começar é resto de outra execução:
    // seguir misturaria trabalho de duas sessões numa entrega só.
    return { ok: false, motivo: `o branch ${previa.branch} já existe antes da execução` }
  }
  // 15/11: sem `origin`, publicar vira entrega LOCAL em vez de recusa. Todo projeto que o Hub
  // cria nasce sem remoto; recusar aqui fazia a primeira tarefa de código em qualquer um deles
  // parar em "não materializou" depois da aprovação. O efeito encolhe (nada sai da máquina),
  // nunca cresce, e o motivo diz isso. O agent aplica a mesma regra (`temRemotoOrigin`).
  if (previa.publicar && !previa.remoto) {
    return {
      ok: true,
      motivo: `sessão em ${previa.branch}, entrega local — publicar foi pedido, mas o repositório não tem remoto origin: o PR não será aberto${notaDeGit(previa.git)}`,
    }
  }
  if (previa.publicar) {
    if (previa.ghAutenticado !== true) {
      return { ok: false, motivo: 'publicar foi pedido, mas o gh não está autenticado nesta máquina' }
    }
    return {
      ok: true,
      motivo: `${previa.retomada ? 'continuação da sessão interrompida, ' : ''}sessão em ${previa.branch}, publicada em PR rascunho ao concluir${notaDeGit(previa.git)}`,
    }
  }
  return { ok: true, motivo: `sessão em ${previa.branch}, entrega local (sem publicar)${notaDeGit(previa.git)}` }
}

/**
 * 21/11 — o postflight MEDIU que nada saiu para o remoto: o checkout é o aprovado, o remoto
 * respondeu, e não há ramo nem PR da sessão lá. Só com esta medida uma recusa de publicação pode
 * fechar o envelope: a recusa registrada diz o que a pessoa quis, e isto diz o que de fato aconteceu.
 * Remoto que não respondeu, checkout diferente ou entrega local não contam — ficam incertos.
 */
export function nadaFoiPublicado(
  resultado: ResultadoDaPreviaDaSessao | null | undefined,
  caminhoAprovado?: string,
): boolean {
  const previa = resultado?.previa
  if (!previa || previa.tipo !== 'sessao_supervisionada' || !resultado?.path) return false
  if (caminhoAprovado && !mesmoCaminho(resultado.path, caminhoAprovado)) return false
  if (!previa.publicar || !previa.remoto) return false
  const e = previa.entrega
  return !e.inconclusiva && !e.commitNoRemoto && !e.prUrl
}

export function verificarEntregaDaSessao(
  resultado: ResultadoDaPreviaDaSessao | null | undefined,
  caminhoAprovado?: string,
): VerificacaoDoEfeito & { entrega?: EntregaDoHandoff } {
  const previa = resultado?.previa
  if (!previa || previa.tipo !== 'sessao_supervisionada' || !resultado?.path) {
    return { estado: 'nao-verificado', motivo: 'a verificacao da sessao nao respondeu — nada a afirmar' }
  }
  if (caminhoAprovado && !mesmoCaminho(resultado.path, caminhoAprovado)) {
    return { estado: 'ausente', motivo: 'o postflight mediu outro checkout, diferente do preflight aprovado' }
  }
  const e = previa.entrega
  const medidoEm = new Date().toISOString()

  // Sem remoto a entrega é local mesmo com publicar pedido — a mesma regra do preflight.
  if (!previa.publicar || !previa.remoto) {
    if (!e.commitLocal) {
      return { estado: 'ausente', motivo: `a tarefa relatou conclusao, mas o branch ${previa.branch} nao tem commit nesta maquina` }
    }
    return {
      estado: 'confirmado',
      motivo: `branch ${previa.branch} em ${e.commitLocal.slice(0, 8)} (entrega local)`,
      entrega: {
        branch: previa.branch, commit: e.commitLocal, publicado: false, remoto: previa.remoto,
        prUrl: null, prEstado: null, prRascunho: null, medidoEm,
      },
    }
  }

  // Não ter conseguido perguntar ao remoto não é o remoto dizer que não existe.
  if (e.inconclusiva) {
    return { estado: 'nao-verificado', motivo: 'nao foi possivel consultar o remoto/gh — nada a afirmar' }
  }
  if (!e.commitNoRemoto) {
    return { estado: 'ausente', motivo: `publicar foi aprovado, mas o branch ${previa.branch} nao esta no remoto` }
  }
  return {
    estado: 'confirmado',
    // PR ausente com branch publicado continua sendo entrega revisável — dito no motivo.
    motivo: e.prUrl
      ? `branch ${previa.branch} no remoto em ${e.commitNoRemoto.slice(0, 8)} · PR ${e.prUrl}`
      : `branch ${previa.branch} no remoto em ${e.commitNoRemoto.slice(0, 8)} · PR nao encontrado`,
    entrega: {
      branch: previa.branch, commit: e.commitNoRemoto, publicado: true, remoto: previa.remoto,
      prUrl: e.prUrl, prEstado: e.prEstado, prRascunho: e.prRascunho, medidoEm,
    },
  }
}

/**
 * S1f (15/11): o que o card precisa dizer ANTES do toque, a partir da prévia gravada no envio.
 *
 * O caso que motivou: sessão com `publicar` num projeto sem `origin` — aprovava-se esperando
 * um PR e a entrega ficava num ramo local, dita só no fim. A prévia já media isso; faltava
 * medir antes de aprovar. Sem prévia gravada, o card diz que não conferiu — nunca cala, porque
 * silêncio aqui se leria como "está tudo certo".
 */
export function avisosAntesDeAprovar(actionKey: string | undefined, preflight: unknown): string[] {
  if (actionKey !== 'jarvis:supervised_session') return []
  const r = (preflight ?? null) as ResultadoDaPreviaDaSessao | null
  const previa = r?.previa
  if (!previa || previa.tipo !== 'sessao_supervisionada') {
    return [r?.error
      ? `A prévia recusou antes da aprovação: ${r.error}`
      : 'Não consegui conferir o repositório antes (o agent do PC estava desligado?) — remoto e PR serão verificados só depois do toque.']
  }
  const avisos: string[] = []
  if (previa.publicar && !previa.remoto) {
    avisos.push('Sem remoto `origin`: não haverá PR — a entrega fica num ramo local deste PC.')
  } else if (previa.publicar && previa.ghAutenticado === false) {
    avisos.push('O `gh` não está autenticado neste PC: o ramo pode subir, mas o PR não será aberto.')
  }
  if ((previa.git?.naoCommitados ?? 0) > 0) avisos.push(`O checkout tem ${previa.git?.naoCommitados} alteração(ões) não commitada(s) — a sessão parte do último commit, sem elas.`)
  return avisos
}
