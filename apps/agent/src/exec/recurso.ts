import { resolve } from 'node:path'

/**
 * ── Posse por TAREFA não impede disputa pelo mesmo RECURSO ───────────────────
 *
 * O A05 fechou a posse da tarefa: `claimTask` é atômico, a posse é um lease renovado, e dois
 * agents nunca executam a mesma tarefa. O que ficou aberto — anotado no R3 e na auditoria — é o
 * degrau ao lado: **duas tarefas diferentes disputando a mesma coisa física**.
 *
 * E o caminho para isso é largo. `index.ts` faz `setInterval(poll, 3000)`, e `poll()` não espera
 * a volta anterior: enquanto uma sessão supervisionada roda por horas, o agent reivindica outra
 * tarefa **a cada 3 segundos**. Não havia teto nenhum.
 *
 * Dois recursos são reais e mensuráveis nesta máquina:
 *
 * | recurso | por que disputam |
 * |---|---|
 * | `dir:<caminho>` | duas ações que ESCREVEM no mesmo diretório — `git_commit` durante um `run_tests`, um `file_write` no meio de uma sessão supervisionada |
 * | `tela` | `screenshot` e `browse_and_screenshot` fotografam **a tela**, não uma aba. O segundo `open(url)` troca o que está na tela enquanto o primeiro espera para fotografar — a evidência sai do teste errado |
 *
 * **Leitura não trava.** `list_dir`, `file_read`, `git_status`, `git_log`, `git_diff` podem correr
 * juntas o quanto quiserem; serializá-las seria trocar um defeito por lentidão, e travar demais é
 * a forma mais fácil de fazer um mecanismo de exclusão ser desligado.
 *
 * Ação sem recurso identificado devolve `null` e corre livre. Preferir o falso-negativo aqui é
 * deliberado: cada chave a mais serializa trabalho que talvez não precisasse, e a lista cresce
 * com evidência — uma ação entra quando se observar disputa, como no catálogo de invariantes.
 */

/** Ações que ESCREVEM no diretório que recebem. Leitura fica fora de propósito. */
const ESCREVEM_NO_DIRETORIO: Record<string, string[]> = {
  'jarvis:file_write':          ['path'],
  'jarvis:file_delete':         ['path'],
  'jarvis:organize_downloads':  ['path'],
  'jarvis:git_branch':          ['path'],
  'jarvis:git_add':             ['path'],
  'jarvis:git_commit':          ['path'],
  'jarvis:git_pull':            ['path'],
  'jarvis:git_push':            ['path'],
  'jarvis:run_command':         ['path'],
  'jarvis:run_tests':           ['projectPath'],
  'jarvis:prisma_generate':     ['projectPath'],
  'jarvis:prisma_migrate':      ['projectPath'],
  'jarvis:run_graphify':        ['projectPath'],
  'jarvis:graphify_sync':       ['cwd'],
  'jarvis:supervised_session':  ['projectPath'],
  'jarvis:capture_test_failure':['projectPath'],
}

/** Ações que capturam a TELA — uma só de cada vez, ou a evidência é de outro momento. */
const USAM_A_TELA = new Set([
  'jarvis:screenshot',
  'jarvis:browse_and_screenshot',
])

/**
 * Chave do recurso que esta tarefa ocupa, ou `null` quando ela não disputa nada.
 *
 * O caminho é normalizado (`resolve` + minúsculas no Windows) porque a mesma pasta escrita de
 * dois jeitos — `C:\Users\...\Projects\x` e `c:/users/.../projects/x` — precisa dar a mesma
 * chave, senão a exclusão existe e não exclui.
 */
export function recursoDaTarefa(action: string, payload: Record<string, unknown>): string | null {
  if (USAM_A_TELA.has(action)) return 'tela'

  const campos = ESCREVEM_NO_DIRETORIO[action]
  if (!campos) return null

  for (const campo of campos) {
    const valor = payload[campo]
    if (typeof valor === 'string' && valor.trim()) return `dir:${normalizar(valor)}`
  }

  // Ação que escreve num diretório e não disse qual cai no cwd do processo — que é UM diretório
  // real, compartilhado por todas elas. Deixar passar sem chave aqui seria exatamente o caso que
  // este módulo existe para pegar.
  return `dir:${normalizar(process.cwd())}`
}

function normalizar(caminho: string): string {
  const absoluto = resolve(caminho)
  return process.platform === 'win32' ? absoluto.toLowerCase() : absoluto
}

/**
 * Fila por chave: tarefas com a mesma chave rodam uma após a outra, chaves diferentes correm em
 * paralelo, e `null` não espera ninguém.
 *
 * Guarda a CAUDA da fila, não um booleano de "ocupado". Com booleano, duas tarefas chegando
 * enquanto a primeira roda ficariam ambas esperando o mesmo sinal e largariam juntas — que é o
 * mesmo problema com uma indireção a mais.
 */
const caudaPorRecurso = new Map<string, Promise<void>>()

export async function comRecurso<T>(chave: string | null, trabalho: () => Promise<T>): Promise<T> {
  if (!chave) return trabalho()

  const anterior = caudaPorRecurso.get(chave) ?? Promise.resolve()

  // `.then(trabalho, trabalho)` nos DOIS ramos: a falha de uma tarefa não pode cancelar a
  // próxima da fila. Um `git_commit` que falha não é motivo para o `run_tests` seguinte nunca
  // rodar — seria transformar um erro de uma tarefa em paralisia do recurso.
  const meu = anterior.then(trabalho, trabalho)

  const cauda = meu.then(() => undefined, () => undefined)
  caudaPorRecurso.set(chave, cauda)

  try {
    return await meu
  } finally {
    // Só limpa se ninguém entrou atrás — senão apagaria a espera de quem já está na fila.
    if (caudaPorRecurso.get(chave) === cauda) caudaPorRecurso.delete(chave)
  }
}

/** Quantos recursos estão ocupados agora — para log e teste, nunca para decidir. */
export function recursosOcupados(): number {
  return caudaPorRecurso.size
}
