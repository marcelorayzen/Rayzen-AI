import { spawn } from 'child_process'
import { execFileSync } from 'child_process'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
// `criarWorktree`/`removerWorktree` moraram aqui até 12/09; extraídas para `exec/workspace-isolado.ts`
// quando o Item A.3 da varredura pós-plano passou a precisar do MESMO mecanismo para `run_command`.
import { executarPrograma } from '../exec/executar-programa'
import { criarWorktree, removerWorktree, type Worktree } from '../exec/workspace-isolado'
import { ambienteDePublicacao, publicarEntrega, temRemotoOrigin, type Executor, type ResultadoDaPublicacao } from '../exec/publicar-entrega'
import {
  OPCOES_COM_MERGE, OPCOES_SEM_MERGE, decidirPublicacao, mesclarQuandoCiPassar, temIntegracaoContinua, type ResultadoDoMerge,
} from '../exec/mesclar-entrega'
import {
  arquivosAlteradosNaSandbox, commitarSobrasNaSandbox, mudancaSoDeDocumentacao, criarRamoNaSandbox, prepararRetomadaNaSandbox, restaurarArvoreNaSandbox, diffNaSandbox, executorDaSandbox, headNaSandbox, modeloNaSandbox,
  garantirPastaDoProjeto, linkDoVscode, pararContainerDaSessao, pastaDaSessao, pastaDoProjetoNoHost,
  prepararCloneNaSandbox, refDeBaseValida, regimeSandboxLigado, repositorioDoProjeto, type MetricasDoClaude,
} from '../exec/sandbox'
import { iniciarPrevia, lerProjetoParaPrevia, previaLigada, type ResultadoDaPrevia } from '../exec/previa-ao-vivo'
import {
  verificarTestesIndependentes, type VerificacaoIndependenteDaSessao,
} from '../exec/verificacao-independente'
import { classificarResposta } from './resposta-aprovacao'
import { branchDaSessao, previaDaSessao } from './previa-da-sessao'
import { resolverExecutavelClaude } from '../exec/resolver-claude'
import { resolverBaseDaSessao } from './base-da-sessao'

const API_URL = process.env.AGENT_API_URL ?? 'http://localhost:3101'
const TOKEN = process.env.AGENT_TOKEN ?? ''
const MAX_ITERATIONS = 20
// Intervalo entre envios de log ao vivo: agrupa chunks para não saturar a API
const LOG_FLUSH_MS = 800
const INTERVALO_VERIFICAR_PARADA_MS = 5000

type AnalysisType = 'question' | 'step_completed' | 'completion' | 'error' | 'noise'

// Protocolo de marcadores: instrui o Claude a sinalizar o estado de forma determinística,
// em vez de o Rayzen adivinhar por regex. Injetado no início de cada prompt do supervised loop.
const PROTOCOL = [
  '[PROTOCOLO RAYZEN — obrigatório]',
  'Trabalhe em etapas pequenas. Ao final de CADA resposta, escreva em linha própria UM marcador:',
  '- [[RAYZEN:STEP_DONE]] — concluiu uma etapa e deve aguardar aprovação antes de seguir.',
  '- [[RAYZEN:QUESTION]] seguido da pergunta — precisa de uma decisão do usuário.',
  '- [[RAYZEN:DONE]] — a missão inteira está concluída.',
  '- [[RAYZEN:ERROR]] seguido da mensagem — um erro impede continuar.',
  'Pare após cada etapa com [[RAYZEN:STEP_DONE]] e aguarde a resposta.',
  '',
  // G4.2 (20/11): medido nas sessões da sandbox, só 2 de 4 leram o AGENTS.md por conta própria e
  // nenhuma leu o PRODUCT.md. O contrato do projeto não pode depender de o modelo lembrar.
  '[CONTRATO DO PROJETO]',
  '- Antes da primeira mudança, leia AGENTS.md na raiz e, se existirem, PRODUCT.md e CLAUDE.md. Eles são o contrato deste repositório: siga as regras e a verificação que pedem.',
  '- Se a tarefa conflitar com o contrato, não escolha sozinho: pergunte com [[RAYZEN:QUESTION]].',
  '',
  // As permissões casam por PREFIXO do comando (`Bash(git status:*)`). Medido em 15/11 na conta
  // isolada: `cat … && git status` foi negado (`cat` é proibido) e `git -C <pasta> status` caiu
  // em "requires approval", porque não começa com `git status`. A sessão parou três etapas
  // seguidas sem poder commitar. Liberar `git -C` não é a saída: `git -C x push` escaparia da
  // negação de `git push`. A saída é dizer as regras a quem roda os comandos.
  '[AMBIENTE — como os comandos são autorizados]',
  '- Você já está na raiz do repositório. Não use `cd` nem `git -C`.',
  '- Um comando por chamada: sem `&&`, `;` ou `|` encadeando comandos.',
  '- Git liberado: status, diff, log, show, add, commit, branch, checkout, stash, restore. `git push` é proibido.',
  // 16/11 (primeira sessão na sandbox): sem esta linha, o modelo terminou o trabalho e PERGUNTOU
  // se podia dar push e abrir o PR — sem marcador, a sessão tratou como pergunta e parou. "Push é
  // proibido" diz o que não fazer; faltava dizer quem faz e o que fazer no lugar.
  '- Publicar não é seu trabalho: o Rayzen faz o push e abre o PR em rascunho DEPOIS que a pessoa aprovar o diff final. Não peça autorização para publicar — commite o trabalho e encerre com [[RAYZEN:DONE]].',
  // 17/11 (PR #8): a última resposta virou o corpo do PR e levava "não fiz push nem abri o PR,
  // conforme o protocolo" e instruções de como montar o corpo — bastidor que só confunde quem lê.
  '- A sua ÚLTIMA resposta (a do [[RAYZEN:DONE]]) vira o corpo do PR, lido por quem revisa. Escreva para essa pessoa: o que mudou, como você verificou e o que fica para ela decidir. Não fale de push, PR, protocolo nem de como montar o corpo.',
  '- Para ler arquivo use a ferramenta Read; `cat`, `head` e `tail` são negados. `ls` e `find` estão liberados.',
  '- Se um pedido mandar rodar um comando negado, cumpra o objetivo pelo caminho permitido e diga isso no relato.',
].join('\n')

const MARKER = /\[\[RAYZEN:(STEP_DONE|QUESTION|DONE|ERROR)\]\]/i

/**
 * ── Permissões da sessão supervisionada ──────────────────────────────────────
 *
 * Até 2026-09-06 isto era `--dangerously-skip-permissions` e nada mais.
 *
 * A substituição foi MEDIDA contra o CLI instalado (2.1.158), não deduzida da doc, e
 * três resultados contrariaram o que eu esperava:
 *
 *  1. `--permission-prompts` NÃO existe nesta versão (a doc diz v2.1.259+). O desenho
 *     que eu ia escrever usava uma flag inexistente.
 *  2. Em modo `-p`, a aprovação é PERMISSIVA por padrão: com apenas `--allowedTools Read`,
 *     um `Write` criou o arquivo em 11s. Não trava esperando prompt — e não restringe.
 *     `--allowedTools` aqui **não é a proteção**.
 *  3. `--disallowedTools` bloqueia de verdade, e bloqueia **mesmo com o bypass ligado**.
 *
 * Conclusão que inverte a intuição: **a lista de NEGAÇÃO é a proteção**; tirar o
 * `--dangerously-skip-permissions` é higiene (ele desliga verificações que não dá para
 * enumerar), não o conserto.
 *
 * A aprovação humana por etapa continua sendo o portão. Esta lista existe para a ação
 * catastrófica ISOLADA, que acontece entre dois checkpoints e não dá tempo de rever.
 */
export const FERRAMENTAS_PERMITIDAS = [
  'Read', 'Glob', 'Grep', 'TodoWrite',
  'Edit', 'Write', 'NotebookEdit',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)',
  'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git branch:*)', 'Bash(git checkout:*)',
  'Bash(git stash:*)', 'Bash(git restore:*)', 'Bash(git worktree:*)',
  'Bash(pnpm:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)',
  // `cat`, `head` e `tail` SAIRAM da permissao em 08/09: eles leem arquivo por um caminho
  // que as negacoes de `Read(**/.env)` nao alcancam. A sessao continua lendo arquivo pela
  // ferramenta `Read`, que respeita as negacoes. Listar (`ls`) e buscar (`find`) ficam.
  'Bash(ls:*)', 'Bash(find:*)',
]

export const FERRAMENTAS_NEGADAS = [
  // Irreversível no disco.
  'Bash(rm:*)', 'Bash(rmdir:*)', 'Bash(git clean:*)', 'Bash(git reset --hard:*)',
  // `git push` em `main` DISPARA BUILD E DEPLOY em produção neste repositório, via
  // webhook. É a negação mais importante da lista: um push entre dois checkpoints
  // publica antes de alguém revisar.
  'Bash(git push:*)',
  // Publicação e infraestrutura.
  'Bash(npm publish:*)', 'Bash(pnpm publish:*)', 'Bash(docker:*)', 'Bash(sudo:*)',
  // Rede arbitrária — exfiltração. `WebFetch`/`WebSearch` ficam de FORA da negação de
  // propósito: são somente-leitura, registradas, e pesquisar documentação é trabalho
  // legítimo numa sessão de código.
  'Bash(curl:*)', 'Bash(wget:*)', 'Bash(ssh:*)', 'Bash(scp:*)',
  // Permissões de arquivo.
  'Bash(chmod:*)', 'Bash(chown:*)',

  // ── Segredo em ARQUIVO — a metade que a allowlist de ambiente não cobre ──────────
  //
  // Limpar o `env` impede o filho de LER a variável; não impede nada do resto. O processo
  // continua rodando como o dono, e as mesmas credenciais existem em disco: `.env` de
  // qualquer projeto, `~/.ssh`, `hook.config.mjs`, `~/.aws`. Negar leitura desses caminhos
  // é o que fecha o par.
  //
  // Não é isolamento — é redução de superfície. Isolamento de verdade é a Fase 4-B
  // (usuário e perfil dedicados), e enquanto ela não existir isto é o que há.
  'Read(**/.env)', 'Read(**/.env.*)', 'Read(**/*.pem)', 'Read(**/*.key)',
  'Read(**/id_rsa*)', 'Read(**/id_ed25519*)',
  'Read(**/hook.config.mjs)', 'Read(**/.npmrc)', 'Read(**/.netrc)',
  'Read(//**/.ssh/**)', 'Read(//**/.aws/**)', 'Read(//**/.claude/**)',
  // Ler por outro caminho é o mesmo que ler: `cat`, `type` e `Get-Content` também saem.
  'Bash(cat:*)', 'Bash(type:*)', 'Bash(more:*)',
]

/**
 * Credenciais que a sessão supervisionada **realmente precisa** — hoje, nenhuma.
 *
 * Documentado porque "quais são indispensáveis?" é a pergunta que decide se a allowlist de
 * ambiente pode ficar como está:
 *
 * | credencial | precisa? | por quê |
 * |---|---|---|
 * | Anthropic / Claude | **não** viaja por env | o CLI usa `~/.claude`, alcançado por `HOME`/`USERPROFILE` |
 * | `AGENT_TOKEN` | **não** | a sessão não fala com a API do Rayzen; quem reporta é o agent, no processo pai |
 * | `LITELLM_MASTER_KEY` | **não** | a sessão usa o modelo da própria conta, não o proxy |
 * | `APPROVAL_TOKEN` | **nunca** | com ela, a sessão criaria as próprias aprovações (Fase 5-A) |
 * | git (push) | **não** | `Bash(git push:*)` é negado; commit local não exige credencial |
 *
 * **Se um dia alguma passar a ser indispensável**, ela entra nomeada e com justificativa — e a
 * sessão fica desabilitada até isso ser decidido. Voltar ao `...process.env` não é opção: é o
 * defeito com outro nome.
 */
export const CREDENCIAIS_INDISPENSAVEIS: readonly string[] = []

function stripMarkers(s: string): string {
  return s.replace(/\[\[RAYZEN:[A-Z_]+\]\]/gi, '').trim()
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[mGKHFJA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

function secaoVerificacao(verificacao: VerificacaoIndependenteDaSessao): string {
  const estado = verificacao.status === 'timeout'
    ? 'não terminou em 10 min'
    : verificacao.status
  const linhas = [
    '### Verificado pelo Rayzen',
    `Resultado: ${estado}`,
    `Comando: ${verificacao.comando}`,
    `Código: ${verificacao.codigo ?? 'sem código de saída'}`,
    `Duração: ${verificacao.duracaoMs} ms`,
    ...(verificacao.ultimasLinhas.length
      ? ['', 'Últimas linhas:', ...verificacao.ultimasLinhas]
      : []),
  ]
  return linhas.join('\n')
}

function criarBufferDeLog(sessionId: string, postar: (path: string, body: unknown) => Promise<unknown>) {
  let logBuffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (!logBuffer) return
    const chunk = logBuffer
    logBuffer = ''
    void postar(`/agent/session/${sessionId}/log`, { chunk: stripAnsi(chunk) }).catch(() => null)
  }
  return {
    adicionar(pedaco: string) {
      logBuffer += pedaco
      if (!flushTimer) {
        flushTimer = setTimeout(() => { flushTimer = null; flush() }, LOG_FLUSH_MS)
      }
    },
    finalizar() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      flush()
    },
  }
}

function analyzeOutput(text: string): { type: AnalysisType; content: string } {
  const clean = stripAnsi(text).trim()
  if (!clean) return { type: 'noise', content: '' }

  // 1) Marcadores explícitos do protocolo — determinístico, prioritário
  const m = clean.match(MARKER)
  if (m) {
    const kind = m[1].toUpperCase()
    const content = stripMarkers(clean).slice(-800)
    if (kind === 'DONE')      return { type: 'completion',     content }
    if (kind === 'ERROR')     return { type: 'error',          content: content.slice(-400) }
    if (kind === 'QUESTION')  return { type: 'question',       content }
    if (kind === 'STEP_DONE') return { type: 'step_completed', content }
  }

  // 2) Fallback heurístico — caso o Claude esqueça o marcador
  const lastLine = clean.split('\n').filter(Boolean).at(-1) ?? ''

  const isQuestion = lastLine.endsWith('?')
    || /\b(qual|escolha|prefere|confirmar|posso|devo|quer|gostaria|como devo|o que você)\b/i.test(lastLine)
  if (isQuestion) return { type: 'question', content: clean.slice(-800) }

  const hasError = /\b(Error:|exception|falhou|failed|ENOENT|EACCES|cannot|undefined is not)\b/.test(clean)
    && !/test.*pass/i.test(clean)

  const isComplete = /(missão concluída|tudo pronto|implementação completa|missão completa)/i.test(clean)
    && !hasError
  if (isComplete) return { type: 'completion', content: clean.slice(-800) }

  const isStepDone = /(✅|concluí|finalizei|implementei|criei|adicionei|atualizei|ajustei|corrigi)/i.test(clean)
    && !hasError
  if (isStepDone) return { type: 'step_completed', content: clean.slice(-800) }

  if (hasError) return { type: 'error', content: clean.slice(-400) }

  return { type: 'noise', content: '' }
}

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function apiGet(path: string) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  return res.json()
}

async function consultarStatusDaSessao(sessionId: string): Promise<string> {
  const res = await fetch(`${API_URL}/agent/session/${sessionId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) throw new Error(`Consulta da sessão falhou (HTTP ${res.status})`)
  const data: unknown = await res.json()
  if (typeof data !== 'object' || data === null || !('status' in data) || typeof data.status !== 'string') {
    throw new Error('Resposta da sessão sem status válido')
  }
  return data.status
}

async function executarModeloComParada(
  executar: () => Promise<string>,
  sessionId: string,
  consultarStatus: (id: string) => Promise<string>,
  pararContainer: (id: string) => Promise<void>,
  intervaloMs: number,
): Promise<{ stopped: true } | { stopped: false; output: string }> {
  let finalizado = false
  let solicitada = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let falhaRelatada = false
  // Se o modelo já terminou, o container já saiu (`--rm`): "no such container" no stop é a parada
  // já consumada, não falha. Sem isto, pedir parada no fim da etapa virava sessão em erro.
  let modeloTerminou = false
  let resolverParada!: () => void
  let rejeitarParada!: (erro: unknown) => void

  const parada = new Promise<void>((resolve, reject) => {
    resolverParada = resolve
    rejeitarParada = reject
  })

  const verificar = async (): Promise<void> => {
    if (finalizado) return
    try {
      const status = await consultarStatus(sessionId)
      if (finalizado) return
      falhaRelatada = false
      if (status === 'stopping') {
        solicitada = true
        await pararContainer(sessionId)
        resolverParada()
        return
      }
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro)
      if (!falhaRelatada) console.error(`Não foi possível verificar/parar a sessão ${sessionId}: ${motivo}`)
      falhaRelatada = true
      if (solicitada) {
        if (modeloTerminou) resolverParada()
        else rejeitarParada(erro)
        return
      }
    }
    if (solicitada) return
    if (!finalizado) timer = setTimeout(() => { void verificar() }, intervaloMs)
  }

  const resultadoModelo = executar().then(
    (output) => { modeloTerminou = true; return { kind: 'output' as const, output } },
    (erro: unknown) => { modeloTerminou = true; return { kind: 'error' as const, erro } },
  )
  void verificar()

  try {
    const primeiro = await Promise.race([
      resultadoModelo,
      parada.then(() => ({ kind: 'stopped' as const })),
    ])
    if (solicitada) {
      await parada
      await resultadoModelo
      return { stopped: true }
    }
    if (primeiro.kind === 'error') throw primeiro.erro
    if (primeiro.kind === 'stopped') return { stopped: true }
    return { stopped: false, output: primeiro.output }
  } finally {
    finalizado = true
    if (timer) clearTimeout(timer)
  }
}

async function pollReply(sessionId: string, timeoutMs = 30 * 60 * 1000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const data = await apiGet(`/agent/session/${sessionId}/reply`) as { reply?: string | null }
    if (data.reply) return data.reply
    await new Promise(r => setTimeout(r, 3000))
  }
  return null
}

/**
 * Isola a execução num `git worktree` próprio, com branch próprio.
 *
 * Sem isto a sessão escreve no MESMO diretório em que você está trabalhando: um passo
 * rejeitado deixa lixo no seu working tree, e uma sessão rodando enquanto você edita
 * disputa os mesmos arquivos.
 *
 * O branch **não é mesclado automaticamente** — decisão tomada em 2026-09-06. Mesclar
 * sozinho devolveria metade do valor do isolamento: o ponto é que nada entre no seu
 * diretório sem você olhar.
 *
 * Devolve `null` quando não é repositório git ou o worktree falha — nesse caso a sessão
 * roda no diretório original, como antes. Degradar é melhor que recusar: o isolamento é
 * uma proteção, não um pré-requisito.
 */
/**
 * Variáveis que a sessão do Claude Code recebe. Tudo o mais fica de fora.
 *
 * Até 2026-09-08 era `env: { ...process.env }`, e a sessão herdava `AGENT_TOKEN`,
 * `LITELLM_MASTER_KEY` e `MCP_READONLY_TOKEN` — credenciais da casa entregues a um processo que
 * roda código de terceiros por definição.
 *
 * **Lista de PERMISSÃO, e o padrão é não passar.** Uma lista de negação deixaria toda variável
 * futura entrar por omissão, que é exatamente como segredo vaza sem ninguém notar. Variável nova
 * exige um gesto explícito aqui.
 *
 * `APPROVAL_TOKEN` está fora **por desenho**: é a credencial que separa quem aprova de quem
 * executa (Fase 5-A). Se ela entrasse, a sessão poderia criar as próprias aprovações e a
 * separação morreria em silêncio. Há teste que falha se aparecer.
 */
const VARIAVEIS_PERMITIDAS = [
  // Sem PATH o `claude` não é encontrado; sem HOME/USERPROFILE ele não acha a própria config.
  'PATH', 'HOME', 'USERPROFILE', 'SHELL',
  // Windows precisa destes para spawn e para resolver executável.
  'SystemRoot', 'SystemDrive', 'windir', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
  'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERNAME', 'COMPUTERNAME',
  // Locale: sem isto a saída vem em C/POSIX e quebra acentuação nos logs.
  'LANG', 'LC_ALL', 'TZ',
  // Node/pnpm precisam achar o próprio runtime.
  'NODE_PATH', 'NVM_DIR', 'PNPM_HOME',
] as const

/**
 * Credenciais que a sessão AINDA precisaria e que hoje **não recebe**.
 *
 * Documentado em vez de resolvido: a sessão do Claude Code faz a própria autenticação com a
 * Anthropic (via `~/.claude`, que ela alcança por `HOME`/`USERPROFILE`), então nenhuma chave de
 * LLM precisa viajar por aqui. Se aparecer um caso que exija credencial, ele entra **nomeado**
 * nesta lista e com justificativa — nunca por um spread.
 *
 * Se a sessão deixar de funcionar por falta de ambiente, ela fica **desabilitada** até haver
 * solução segura. Voltar ao spread não é solução; é o defeito com outro nome.
 */
export const CREDENCIAIS_NAO_REPASSADAS = [
  'AGENT_TOKEN', 'LITELLM_MASTER_KEY', 'MCP_READONLY_TOKEN', 'APPROVAL_TOKEN',
  'ADMIN_PASSWORD', 'DATABASE_URL', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY',
] as const

export function ambienteMinimo(fonte: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const saida: NodeJS.ProcessEnv = {}
  for (const chave of VARIAVEIS_PERMITIDAS) {
    const v = fonte[chave]
    if (v !== undefined) saida[chave] = v
  }
  return saida
}

/**
 * O que o usuário precisa fazer com o branch quando a sessão termina.
 *
 * Vai junto do resumo de conclusão porque um branch que ninguém sabe que existe é igual
 * a trabalho perdido.
 *
 * O CHECKOUT normalmente é liberado na hora por `removerWorktree()`, em `finally`. **Mas nem
 * sempre**: desde a correção de A01 (13/09), um worktree com trabalho não commitado é
 * PRESERVADO em vez de apagado. Por isso o caminho aparece aqui — preservar em silêncio
 * trocaria perda de dados por trabalho esquecido em `tmpdir()`, que é melhor, mas não é o
 * objetivo.
 */
export function instrucoesDeMerge(base: string, wt: { dir: string; branch: string }): string {
  return [
    '',
    '---',
    `Trabalho isolado no branch \`${wt.branch}\`.`,
    'Nada foi escrito no seu diretório de trabalho. Para revisar e incorporar:',
    '',
    '```bash',
    `cd ${base}`,
    `git diff main...${wt.branch}          # ver o que mudou`,
    `git merge ${wt.branch}                # incorporar`,
    `git branch -d ${wt.branch}            # apagar o branch depois do merge`,
    '```',
    '',
    `Para descartar: \`git branch -D ${wt.branch}\``,
    '',
    `Se a sessão deixou alterações sem commit, o checkout foi preservado em \`${wt.dir}\` —`,
    'confira antes de apagar o branch.',
  ].join('\n')
}

/** Publicar foi pedido e o repositório não tem `origin`: dito, nunca calado. */
export function notaSemRemoto(semRemoto: boolean): string {
  return semRemoto
    ? '\n\n---\nPublicar foi pedido, mas o projeto não tem remoto `origin`: o PR não foi aberto e a entrega fica no ramo local abaixo.'
    : ''
}

/**
 * Rodapé da conclusão quando o envelope pediu `publicar: true` (item 7.2a).
 *
 * Publicado: o link vem primeiro, porque é o que se abre do celular. Recusado ou falho: diz o
 * motivo E cai nas instruções locais — o branch continua existindo neste PC, e esconder isso
 * trocaria uma publicação que falhou por trabalho esquecido.
 */
export function rodapeDeEntrega(
  base: string,
  wt: { dir: string; branch: string },
  publicacao: ResultadoDaPublicacao,
): string {
  if (!publicacao.ok) {
    return `\n\n---\nA entrega NÃO foi publicada (${publicacao.motivo}${publicacao.detalhe ? `: ${publicacao.detalhe}` : ''}).` +
      instrucoesDeMerge(base, wt)
  }
  const e = publicacao.entrega
  return [
    '',
    '---',
    e.prUrl ? `Entrega: ${e.prUrl} (PR em rascunho — o merge é seu).` : `Entrega publicada no branch \`${e.branch}\`; o PR não abriu: ${e.prErro}.`,
    `Branch \`${e.branch}\` · ${e.commitsAFrente} commit(s) à frente de \`${e.base}\` · ${e.diffstat || 'sem diffstat'}`,
    `Commit \`${e.commit.slice(0, 12)}\`. Nada foi escrito no seu diretório de trabalho.`,
  ].join('\n')
}

/**
 * O que esta etapa mudou, para o card de aprovação.
 *
 * Compara contra `desde` — o HEAD de antes da etapa — e **não** contra `HEAD`. Medido em
 * 11/09: a sessão criou um arquivo, commitou, e `git diff --stat HEAD` devolveu vazio, assim
 * como `git status --short`, porque não sobrou nada fora do commit. O card ficaria em branco
 * exatamente no passo que produziu código. Com `git commit` na lista de ferramentas
 * permitidas, esse é o caminho comum, não a exceção.
 *
 * `execFileSync` com argv, nunca `execSync` com a string montada: o sha entra como argumento,
 * não como texto a ser interpretado. É o que mantém esta linha fora da coluna "montada" do
 * inventário de `docs/exec-paths.md`.
 */
function getGitDiff(cwd: string, desde?: string): string {
  const rodar = (args: string[]) =>
    execFileSync('git', args, { cwd, timeout: 5000, encoding: 'utf8' }).trim()
  try {
    const stat = rodar(['diff', '--stat', desde ?? 'HEAD'])
    if (stat) return stat
    // Nada versionado mudou — pode haver arquivo não rastreado.
    return rodar(['status', '--short'])
  } catch {
    return ''
  }
}

/** HEAD atual, ou string vazia fora de um repositório. Marca o início de uma etapa. */
function headAtual(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/**
 * Executa Claude com streaming ao vivo de stdout → API (/agent/session/:id/log).
 * Agrupa chunks num buffer e faz flush a cada LOG_FLUSH_MS para não saturar a API.
 */
function runClaude(prompt: string, cwd: string, sessionId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const allChunks: Buffer[] = []
    const log = criarBufferDeLog(sessionId, apiPost)

    // `resolverExecutavelClaude()`: no Windows, o binário real por trás do `claude.cmd` — `spawn`
    // sem shell não executa `.cmd` (ENOENT na primeira sessão real, 12/11), e shell está fora.
    const proc = spawn(resolverExecutavelClaude(), [
      '-p', prompt,
      '--allowedTools',    ...FERRAMENTAS_PERMITIDAS,
      '--disallowedTools', ...FERRAMENTAS_NEGADAS,
    ], {
      cwd,
      env: ambienteMinimo(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    proc.stdout.on('data', (d: Buffer) => {
      allChunks.push(d)
      log.adicionar(d.toString('utf8'))
    })

    proc.stderr.on('data', (d: Buffer) => {
      allChunks.push(d)
    })

    proc.on('close', (code) => {
      log.finalizar()
      const output = Buffer.concat(allChunks).toString('utf8')
      if (code === 0) resolve(output)
      else reject(new Error(output || `claude exited with code ${code}`))
    })

    proc.on('error', (err) => {
      log.finalizar()
      reject(err)
    })
  })
}

function copyPreviewFiles(outputDir: string, sessionId: string): string | null {
  const destDir = resolve(process.cwd(), '../../storage/previews', sessionId)
  try {
    mkdirSync(destDir, { recursive: true })
    const files = readdirSync(outputDir)
    for (const file of files) {
      const src = join(outputDir, file)
      const dest = join(destDir, file)
      if (statSync(src).isFile()) copyFileSync(src, dest)
    }
    return destDir
  } catch {
    return null
  }
}

/** G3.2: o que a sessão de continuação precisa saber antes do pedido original. */
export const NOTA_DE_RETOMADA = [
  '[RETOMADA] Esta é a continuação de uma sessão interrompida no meio do trabalho. O que ela já fez',
  'está commitado neste ramo: veja `git log` e `git diff` contra o ponto de partida antes de mexer',
  'em qualquer arquivo. Não refaça o que já está feito. Termine só o que falta do pedido abaixo;',
  'se ele já estiver completo, confira e responda com o marcador de conclusão.',
].join(' ')

export async function supervisedSession(payload: {
  sessionId: string
  prompt: string
  projectId?: string
  projectPath?: string
  previewOutputPath?: string
  /**
   * Publicar a entrega (branch `rayzen/*` + PR em rascunho) ao concluir. Só `true` literal:
   * o efeito externo precisa ter sido pedido no envelope aprovado, nunca inferido.
   */
  publicar?: boolean
  /** Prévia do ProjectHandoff (pré e pós-execução): só lê, nunca roda o modelo. */
  dryRun?: boolean
  /** Nome do envelope (vem do ProjectHandoff) — título do PR; sem ele, a 1ª linha do pedido. */
  nomeDoEnvelope?: string
  /**
   * Item 7.3 (13/11): como a sessão é supervisionada, declarado no envelope aprovado.
   * `por_entrega` — as etapas seguem sem parar no worktree isolado; o portão é o diff completo
   * antes de publicar. Qualquer outro valor, INCLUSIVE ausente, é `por_etapa`: envelopes
   * anteriores foram aprovados quando "aprovar" significava acompanhar etapa por etapa.
   */
  aprovacao?: 'por_etapa' | 'por_entrega'
  /**
   * G6, fatia 4 (21/11): ramo de onde a sessão parte e contra o qual o PR é aberto — para corrigir
   * um PR a partir do ramo dele. Só na sandbox; ausente, nada muda (topo do branch padrão).
   */
  baseRef?: string
  /**
   * G3.2 (24/11): id da sessão interrompida que esta continua. A sessão nova trabalha na PASTA e
   * no RAMO da antiga — o checkpoint é o git, não a conversa do modelo. Só na sandbox.
   */
  retomaDe?: string
}, dependencias: {
  executarModelo?: (
    prompt: string, cwd: string, sessionId: string, aoMedir?: (metricas: MetricasDoClaude) => void,
    aoProgredir?: (linha: string) => void,
  ) => Promise<string>
  consultarStatus?: (sessionId: string) => Promise<string>
  pararContainer?: (sessionId: string) => Promise<void>
  intervaloParadaMs?: number
  postar?: (path: string, body: unknown) => Promise<unknown>
  aguardarResposta?: (sessionId: string, timeoutMs?: number) => Promise<string | null>
  publicar?: typeof publicarEntrega
  /**
   * S3 (16/11): executor da sandbox. `undefined` = decide pelo ambiente (`regimeSandboxLigado`);
   * `null` = força o PC. O teste injeta um executor falso para provar o regime sem docker.
   */
  sandbox?: Executor | null
  /**
   * Item 3 (17/11): prévia ao vivo no portão do diff. `undefined` = decide pelo ambiente
   * (`previaLigada`); `null` = desligada. O teste injeta para provar sem docker.
   */
  previa?: { iniciar: (repo: string, sessionId: string) => Promise<ResultadoDaPrevia>; url: string } | null
  verificarTestes?: (
    executar: Executor, repo: string, sessionId: string,
  ) => Promise<VerificacaoIndependenteDaSessao>
} = {}) {
  const { sessionId, prompt, projectId, projectPath, previewOutputPath } = payload
  if (payload.dryRun === true) {
    // Antes de qualquer `postar`: a prévia não é a sessão, e não pode mexer no estado dela.
    return previaDaSessao({ sessionId, projectId, projectPath, publicar: payload.publicar, retomaDe: payload.retomaDe })
  }
  const pediuPublicar = payload.publicar === true
  const porEntrega = payload.aprovacao === 'por_entrega'
  const publicar = dependencias.publicar ?? publicarEntrega
  // Pontos de injeção estreitos para a prova determinística do protocolo. Em produção os
  // defaults continuam sendo Claude + API reais; o teste troca somente as fronteiras externas,
  // sem criar um segundo fluxo de sessão que poderia divergir do usado pelo executor.
  const postar = dependencias.postar ?? apiPost
  const aguardarResposta = dependencias.aguardarResposta ?? pollReply
  const consultarStatus = dependencias.consultarStatus ?? consultarStatusDaSessao
  const pararContainer = dependencias.pararContainer ?? pararContainerDaSessao
  const intervaloParadaMs = dependencias.intervaloParadaMs ?? INTERVALO_VERIFICAR_PARADA_MS

  // S3 (16/11): regime `sandbox` — a sessão roda no servidor, num container descartável, com o
  // clone em ~/workspaces/<repo>/sessao-<id> (item 2). Só quatro coisas mudam (onde o modelo
  // roda, HEAD, diff, publicar); o laço de etapas e o portão do diff são os mesmos dos outros
  // regimes. O executor nasce DEPOIS de saber o repositório, porque a pasta montada depende dele.
  const usarSandbox = dependencias.sandbox !== undefined ? dependencias.sandbox !== null : regimeSandboxLigado()
  let sandbox: Executor | null = dependencias.sandbox ?? null
  let repoDaSandbox = ''
  // No agent-server, sessão SÓ na sandbox: os regimes do PC rodariam dentro do próprio container
  // do agent, com docker.sock e o repositório do servidor à vista. Falha fechado.
  if (!usarSandbox && process.env.AGENT_ROLE === 'server' && dependencias.sandbox === undefined) {
    const msg = 'sessão chegou ao agent-server com a sandbox desligada (AGENT_SESSAO_SANDBOX) — recusada em vez de rodar sem isolamento'
    await postar(`/agent/session/${sessionId}/error`, { message: msg })
    return { ok: false, sessionId, error: msg }
  }
  const executarModelo = dependencias.executarModelo
    ?? (usarSandbox
      ? ((
        p: string, c: string, _id: string,
        aoMedir?: (metricas: MetricasDoClaude) => void,
        aoProgredir?: (linha: string) => void,
      ) => modeloNaSandbox(
        sandbox as Executor,
        { permitidas: FERRAMENTAS_PERMITIDAS, negadas: FERRAMENTAS_NEGADAS },
      )(p, c, aoMedir, aoProgredir))
      : runClaude)

  // A03: o payload enfileirado traz `projectId`, não caminho. `projectId` que não resolve
  // RECUSA a sessão — nunca cai em `process.cwd()`, que faria a sessão escrever código num
  // repositório que ninguém pediu, sem erro e sem aviso.
  let base: string
  let headDaSandbox = ''
  if (usarSandbox) {
    const recusa = (msg: string) => postar(`/agent/session/${sessionId}/error`, { message: msg.slice(0, 300) })
      .then(() => ({ ok: false, sessionId, error: msg }))
    if (!pediuPublicar) return recusa('na sandbox a entrega é sempre PR em rascunho — o envelope precisa de publicar: true')
    if (!projectId) return recusa('a sandbox resolve o repositório pelo projectId, e ele não veio')
    if (payload.baseRef !== undefined && !refDeBaseValida(payload.baseRef)) {
      return recusa(`ramo de base inválido no envelope: "${String(payload.baseRef).slice(0, 60)}"`)
    }
    const alvo = await repositorioDoProjeto(projectId)
    if ('erro' in alvo) return recusa(alvo.erro)
    if (!sandbox) {
      const pasta = await garantirPastaDoProjeto(alvo.repo)
      if (!pasta.ok) return recusa(pasta.erro)
      sandbox = executorDaSandbox(pasta.pasta, undefined, sessionId)
    }
    repoDaSandbox = alvo.repo
    if (payload.retomaDe !== undefined) {
      // G3.2: continuação — pasta e ramo da sessão interrompida, sem clone novo e sem `-B`.
      const retomada = await prepararRetomadaNaSandbox(sandbox, payload.retomaDe, payload.baseRef)
      if (!retomada.ok) return recusa(retomada.erro)
      base = retomada.base
      headDaSandbox = retomada.headInicial
    } else {
      const clone = await prepararCloneNaSandbox(sandbox, alvo.dono, alvo.repo, sessionId)
      if (!clone.ok) return recusa(clone.erro)
      base = clone.base
      try {
        headDaSandbox = await criarRamoNaSandbox(sandbox, base, branchDaSessao(sessionId), payload.baseRef)
      } catch (err) {
        return recusa((err as Error).message)
      }
    }
    // G2.9 (24/11): o cartão "em andamento" do Hub oferece assumir pelo VS Code DURANTE a
    // sessão. Só o agent sabe montar o link (repositório, pasta no host, destino SSH).
    postar(`/agent/session/${sessionId}/log`, {
      chunk: '\n[pasta da sessão pronta]\n',
      vscodeUrl: linkDoVscode(alvo.repo, payload.retomaDe ?? sessionId),
    }).catch(() => null)
  } else {
    if (payload.retomaDe !== undefined) {
      const msg = 'retomar uma sessão interrompida só funciona na sandbox do servidor'
      await postar(`/agent/session/${sessionId}/error`, { message: msg })
      return { ok: false, sessionId, error: msg }
    }
    // `baseRef` só existe na sandbox: o regime local (reserva) parte do checkout do dono e não
    // publica contra outro ramo. Recusar é melhor que ignorar — ignorar abriria o PR contra `main`.
    if (payload.baseRef !== undefined) {
      const msg = 'baseRef (partir do ramo de um PR) só funciona na sandbox do servidor'
      await postar(`/agent/session/${sessionId}/error`, { message: msg })
      return { ok: false, sessionId, error: msg }
    }
    const resolucao = await resolverBaseDaSessao({ projectId, projectPath })
    if ('erro' in resolucao) {
      await postar(`/agent/session/${sessionId}/error`, { message: resolucao.erro.slice(0, 300) })
      return { ok: false, sessionId, error: resolucao.erro }
    }
    base = resolucao.base
  }
  // Publicar exige `origin`. Sem ele a entrega é LOCAL (ramo neste PC), a mesma regra que o
  // preflight do handoff aplica. Perguntar "publicar como PR?" e depois falhar em `sem_remoto`
  // pediria uma aprovação que não leva a lugar nenhum.
  const semRemoto = pediuPublicar && !(await temRemotoOrigin(base, sandbox ? { executar: sandbox } : {}))
  const deveSerPublicada = pediuPublicar && !semRemoto

  /**
   * Dois regimes: `sandbox` (S3, no servidor, isolado pelo container) e `local` (no PC, como o
   * DONO, isolado por worktree — redução de superfície, não isolamento; fica como reserva).
   * O regime `isolado` da conta RayzenExec (Fase 4-B) saiu na S4.3, em 20/11/2026.
   */
  let worktree: { dir: string; branch: string } | null = null
  let cwd = base

  if (!sandbox) {
    // Isolamento por worktree. Quando não dá (não é git, ou o comando falha), roda no
    // diretório original — degradar é melhor que recusar.
    worktree = await criarWorktree(base, sessionId)
    cwd = worktree?.dir ?? base
  }
  // Na sandbox o isolamento é o container; o ramo já foi criado no clone do volume.

  const headDe = async (dir: string) => (sandbox ? headNaSandbox(sandbox, dir) : headAtual(dir))
  const diffDe = async (dir: string, desde?: string) => (sandbox ? diffNaSandbox(sandbox, dir, desde) : getGitDiff(dir, desde))

  // Item A.1 da varredura de 2026-09-12: todo `return` a partir daqui passa por aqui, então o
  // worktree (se existir) é sempre liberado — sucesso, erro, ou o fallback de iterações
  // esgotadas. `worktree` só existe no regime local; na sandbox é sempre `null` e a chamada
  // abaixo não faz nada.
  const finalizar = async <T extends Record<string, unknown>>(resultado: T): Promise<T> => {
    if (!worktree) return resultado
    const limpeza = await removerWorktree(base, worktree)
    if (!limpeza.preservadoPorWip) return resultado

    // Uma queda/erro pode acontecer depois de o modelo escrever e antes de commitar. O git
    // preserva o checkout, mas sem devolver sua localização o trabalho fica efetivamente
    // perdido para o operador. Isto não retoma nem repete o efeito: apenas torna o estado
    // recuperável e exige decisão humana antes de qualquer nova execução.
    return {
      ...resultado,
      recoveryRequired: true,
      branch: worktree.branch,
      worktree: worktree.dir,
    }
  }

  // HEAD de onde a sessão partiu — base do diff mostrado antes de publicar (a sessão commita, e
  // contra o próprio commit `git diff HEAD` sairia vazio).
  const headInicial = sandbox ? headDaSandbox : (worktree ? headAtual(cwd) : '')
  // G3.2: numa continuação, pasta, ramo, prévia e verificação são da sessão ANTIGA. O id novo
  // segue sendo o da API, do log e do container (é por ele que "parar" acha a sessão).
  const sessaoDaPasta = payload.retomaDe ?? sessionId

  const basePrompt = `${PROTOCOL}\n\n${payload.retomaDe !== undefined ? `${NOTA_DE_RETOMADA}\n\n` : ''}${prompt}`
  let context = basePrompt
  let iteration = 0

  while (iteration < MAX_ITERATIONS) {
    iteration++
    let output: string

    // Marca o início da etapa ANTES de a sessão poder commitar.
    const headDaEtapa = await headDe(cwd)

    try {
      const aoMedir = sandbox
        ? (metricas: MetricasDoClaude) => {
          const body = {
            ...(metricas.custoUsd !== undefined ? { costUsd: metricas.custoUsd } : {}),
            ...(metricas.turnos !== undefined ? { numTurns: metricas.turnos } : {}),
            ...(metricas.sessaoId !== undefined ? { modelSessionId: metricas.sessaoId } : {}),
            papel: 'developer',
            provedor: 'claude-code',
            ...(metricas.modelo !== undefined ? { modelo: metricas.modelo } : {}),
          }
          void Promise.resolve()
            .then(() => postar(`/agent/session/${sessionId}/metrics`, body))
            .catch(() => null)
        }
        : undefined
      const log = sandbox ? criarBufferDeLog(sessionId, postar) : null
      try {
        const executar = () => executarModelo(
          context,
          cwd,
          sessionId,
          aoMedir,
          log ? (linha) => log.adicionar(`${linha}\n`) : undefined,
        )
        if (sandbox) {
          const resultado = await executarModeloComParada(
            executar,
            sessionId,
            consultarStatus,
            pararContainer,
            intervaloParadaMs,
          )
          if (resultado.stopped) {
            const registrado: unknown = await postar(`/agent/session/${sessionId}/stopped`, {})
            if (typeof registrado !== 'object' || registrado === null || !('ok' in registrado) || registrado.ok !== true) {
              throw new Error('A API não confirmou o estado stopped da sessão')
            }
            return finalizar({ ok: false, sessionId, status: 'stopped' })
          }
          output = resultado.output
        } else {
          output = await executar()
        }
      } finally {
        log?.finalizar()
      }
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300)
      await postar(`/agent/session/${sessionId}/error`, { message: msg })
      return finalizar({ ok: false, sessionId, error: msg })
    }

    const { type, content } = analyzeOutput(output)

    if (type === 'question') {
      await postar(`/agent/session/${sessionId}/question`, { question: content, requiresApproval: false })
      const reply = await aguardarResposta(sessionId)
      if (reply) {
        // A pergunta vai JUNTO: cada etapa começa sem a conversa anterior, e em 15/11 a sessão
        // recebeu "B" e depois "sim" sem saber a que respondiam.
        context = `${basePrompt}\n\n[Progresso até aqui]:\n${content}\n\n[Resposta do usuário a essa pergunta]: ${reply}\n\n[Continuar a implementação]`
      } else {
        context = `${basePrompt}\n\n[O usuário não respondeu a tempo — use o melhor julgamento para continuar]`
      }
      continue
    }

    if (type === 'step_completed' && porEntrega) {
      // Item 7.3: sem portão por etapa. O progresso vai para o log (visível na sessão) e a
      // sessão segue. Nada sai do worktree sem o portão do fim, que mostra o diff inteiro
      // contra `headInicial`; MAX_ITERATIONS continua sendo o teto.
      postar(`/agent/session/${sessionId}/log`, { chunk: `\n[etapa ${iteration} concluída — aprovação por entrega, seguindo]\n` }).catch(() => null)
      context = `${basePrompt}\n\n[Progresso até aqui]:\n${content}\n\n[Etapa registrada. Este envelope é aprovado POR ENTREGA: siga para a próxima etapa sem esperar; a pessoa revisa o diff completo no fim.]`
      continue
    }

    if (type === 'step_completed') {
      // Captura o diff desta etapa para exibição no ApprovalCard
      const diff = await diffDe(cwd, headDaEtapa || undefined)
      const question = diff
        ? `${content}\n\n---DIFF---\n${diff}`
        : content

      await postar(`/agent/session/${sessionId}/question`, {
        question,
        requiresApproval: true,
        approvalOptions: ['Aprovado, continue', 'Rejeitar e corrigir', 'Modificar instrução'],
      })
      const reply = await aguardarResposta(sessionId)
      const decisao = classificarResposta(reply)

      // A02: até 13/09 a ausência de resposta caía no ramo APROVOU, junto com `\bpode\b`
      // casando dentro de "não pode". Silêncio não é autorização — a sessão PARA, e o
      // trabalho feito até aqui continua alcançável pelo branch.
      if (decisao === 'sem_resposta') {
        const onde = worktree
          ? ` O que já foi feito está no branch \`${worktree.branch}\`.`
          : ''
        await postar(`/agent/session/${sessionId}/error`, {
          message:
            'A etapa aguardava aprovação e não houve resposta. A sessão parou sem continuar ' +
            `— nenhuma etapa nova foi executada.${onde}`,
        })
        return finalizar({ ok: false, sessionId, motivo: 'aprovacao_sem_resposta' })
      }

      if (decisao === 'aprovado') {
        context = `${basePrompt}\n\n[Progresso até aqui]:\n${content}\n\n[O usuário APROVOU esta etapa. Continue com a próxima etapa.]`
      } else if (decisao === 'rejeitado') {
        context = `${basePrompt}\n\n[Progresso até aqui]:\n${content}\n\n[O usuário REJEITOU esta etapa. Desfaça o que foi feito nela e tente uma abordagem diferente.]`
      } else {
        context = `${basePrompt}\n\n[Progresso até aqui]:\n${content}\n\n[Instrução modificada pelo usuário]: ${reply}\n\n[Aplique a modificação e continue.]`
      }
      continue
    }

    if (type === 'completion') {
      let previewUrl: string | undefined
      if (previewOutputPath) {
        const destDir = copyPreviewFiles(previewOutputPath, sessionId)
        if (destDir) {
          const vpsIp = process.env.VPS_PUBLIC_IP ?? ''
          previewUrl = vpsIp ? `http://${vpsIp}/preview/${sessionId}/index.html` : undefined
        }
      }
      // Decisão de 12/11: nada sai sem a pessoa ver o diff. Na prova real a sessão declarou
      // DONE numa etapa só e publicou sem nenhum olhar humano sobre a mudança — o gate havia
      // aprovado o PEDIDO, não o RESULTADO. Silêncio e recusa não publicam (mesma regra do A02);
      // o branch fica local e alcançável. UM portão para os dois regimes (7.2c): duplicá-lo seria
      // o jeito de um deles um dia publicar sem perguntar.
      //
      // 16/11: "Aprovado, mesclar" — o Rayzen abre o PR e mescla quando o CI do repositório passa.
      // Só é oferecido onde há CI; sem ele, o portão é o de antes (publicar ou não).
      const executorDePublicacao: Executor = sandbox
        ?? ((programa, args, o) => executarPrograma('executavel', programa, args, { ...o, env: ambienteDePublicacao() }))
      let mesclagem: ResultadoDoMerge | undefined
      // Item 3 (17/11): na sandbox, o link da prévia ao vivo entra na pergunta — ver antes de aprovar.
      let notaDaPrevia = ''
      let notaDaVerificacao = ''
      let verificacaoDaSessao: VerificacaoIndependenteDaSessao | undefined
      const publicarComAprovacao = async (ramo: string, diff: string): Promise<ResultadoDaPublicacao> => {
        const comMerge = await temIntegracaoContinua(executorDePublicacao, base)
        const pergunta = comMerge
          ? 'Publicar esta entrega? "Mesclar" abre o PR e mescla no main quando o CI passar; com o CI vermelho, o PR fica aberto.'
          : 'Publicar esta entrega como PR em rascunho?'
        await postar(`/agent/session/${sessionId}/question`, {
          question: `${content}${notaDaPrevia}${notaDaVerificacao ? `\n\n${notaDaVerificacao}` : ''}\n\n${pergunta}${diff ? `\n\n---DIFF---\n${diff}` : ''}`,
          requiresApproval: true,
          approvalOptions: [...(comMerge ? OPCOES_COM_MERGE : OPCOES_SEM_MERGE)],
          // HC6: a prévia vai junto com o portão, para o cartão mostrar o botão ANTES da decisão.
          ...(previewUrl ? { previewUrl } : {}),
        })
        const resposta = await aguardarResposta(sessionId)
        const decisao = decidirPublicacao(resposta, comMerge)
        if (decisao === 'nao') {
          return {
            ok: false,
            motivo: 'publicacao_nao_autorizada',
            detalhe: !resposta?.trim() ? 'sem resposta à aprovação do diff' : 'a publicação foi recusada',
          }
        }
        const nome = typeof payload.nomeDoEnvelope === 'string' && payload.nomeDoEnvelope.trim()
          ? payload.nomeDoEnvelope.trim()
          : (prompt.split(/\r?\n/).find((l) => l.trim()) ?? 'sessão').trim()
        const titulo = `Rayzen · ${nome.slice(0, 100)}`
        const quemMescla = decisao === 'mesclar'
          ? 'a pessoa pediu para mesclar, o que só acontece com o CI verde'
          : 'revisão e merge são humanos'
        const corpo = `${content}\n\n---\nSessão supervisionada \`${sessionId}\`. PR aberto pelo Rayzen depois de aprovação humana do diff; ${quemMescla}.` +
          (notaDaVerificacao ? `\n\n${notaDaVerificacao}` : '')
        const publicado = await publicar(base, ramo, { titulo, corpo }, sandbox
          ? { executar: sandbox, ...(payload.baseRef !== undefined ? { baseRef: payload.baseRef } : {}) }
          : {})
        if (decisao === 'mesclar' && publicado.ok && publicado.entrega.prUrl) {
          postar(`/agent/session/${sessionId}/log`, { chunk: '\n[PR aberto — aguardando o CI para mesclar]\n' }).catch(() => null)
          mesclagem = await mesclarQuandoCiPassar(executorDePublicacao, base, ramo)
        }
        return publicado
      }
      const notaDoMerge = (): string => {
        if (!mesclagem) return ''
        if (mesclagem.ok) {
          const commit = mesclagem.commit ? ` — commit \`${mesclagem.commit.slice(0, 12)}\`` : ''
          return `\nMesclado no main (squash) depois de ${mesclagem.checks} check(s) verde(s)${commit}.`
        }
        return `\nNÃO mesclei (${mesclagem.motivo}: ${mesclagem.detalhe}). O PR continua aberto para você decidir.`
      }

      let rodape = ''
      let publicacao: ResultadoDaPublicacao | undefined
      if (sandbox) {
        // S3: o que ficou sem commit vira commit (o volume não é alcançável — trabalho fora de
        // commit se perderia), e o portão é o MESMO: diff inteiro desde o início, publicar só
        // com "Aprovado". Recusado ou sem resposta, o ramo fica só no volume e isso é dito.
        // G2.7: commit ANTES de verificar — o que o `npm test` escreve não pode entrar no PR como
        // trabalho do modelo. Depois, a árvore volta ao HEAD (o diff do portão lê a árvore).
        await commitarSobrasNaSandbox(sandbox, base)
        const verificar = dependencias.verificarTestes ?? verificarTestesIndependentes
        verificacaoDaSessao = await verificar(sandbox, repoDaSandbox, sessaoDaPasta)
        notaDaVerificacao = secaoVerificacao(verificacaoDaSessao)
        await restaurarArvoreNaSandbox(sandbox, base)
        const ramo = branchDaSessao(sessaoDaPasta)
        // Item 3: a prévia sobe EM PARALELO à pergunta (a instalação leva um ou dois minutos) e
        // o resultado vai para o log da sessão. Projeto que não sabemos servir diz por quê.
        const previa = dependencias.previa !== undefined
          ? dependencias.previa
          : (previaLigada() ? { iniciar: (r: string, s: string) => iniciarPrevia(r, s), url: (process.env.PREVIA_URL ?? '').replace(/\/+$/, '') } : null)
        // 24/11: mudança só de documentação não oferece prévia — o app subiria igual ao de antes.
        const soDocs = previa && repoDaSandbox
          ? mudancaSoDeDocumentacao(await arquivosAlteradosNaSandbox(sandbox, base, headInicial || undefined))
          : false
        if (soDocs) {
          notaDaPrevia = '\n\n(Sem prévia: a mudança só toca documentação e não altera o app. Confira pelo diff abaixo.)'
        } else if (previa && repoDaSandbox) {
          const avaliacao = await lerProjetoParaPrevia(sandbox, base)
          if (avaliacao.ok) {
            notaDaPrevia = `\n\nPrévia ao vivo (sobe em 1–2 min): ${previa.url}`
            previewUrl = previewUrl ?? previa.url
            void previa.iniciar(repoDaSandbox, sessaoDaPasta).then((r) => postar(`/agent/session/${sessionId}/log`, {
              chunk: r.ok ? `\n[prévia no ar: ${r.url}]\n` : `\n[a prévia não subiu: ${r.erro}]\n`,
            })).catch(() => null)
          } else {
            notaDaPrevia = `\n\n(Sem prévia ao vivo: ${avaliacao.motivo}.)`
          }
        }
        publicacao = await publicarComAprovacao(ramo, await diffDe(base, headInicial || undefined))
        rodape = publicacao.ok
          ? `\n\n---\nEntrega publicada em PR rascunho${publicacao.entrega.prUrl ? `: ${publicacao.entrega.prUrl}` : ` (o PR não abriu: ${publicacao.entrega.prErro ?? 'sem detalhe'})`} — ramo \`${ramo}\`, ${publicacao.entrega.commitsAFrente} commit(s).${notaDoMerge()}`
          : `\n\n---\nNada foi publicado (${publicacao.motivo}${publicacao.detalhe ? `: ${publicacao.detalhe}` : ''}). O ramo \`${ramo}\` ficou só no servidor.`
        // Item 2 (16/11): onde o trabalho está, para o dono abrir e assumir pelo VS Code.
        if (repoDaSandbox) {
          rodape += `\nNo servidor: \`${pastaDoProjetoNoHost(repoDaSandbox)}/${pastaDaSessao(sessaoDaPasta)}\` — abrir no VS Code (Remote-SSH): ${linkDoVscode(repoDaSandbox, sessaoDaPasta)}`
        }
        if (notaDaPrevia.includes('Prévia ao vivo') && previa) {
          rodape += `\nPrévia ao vivo: ${previa.url} (fica no ar por 2 h; editar a pasta pelo VS Code recarrega a prévia).`
        }
      } else if (worktree && deveSerPublicada) {
        // O worktree compartilha os refs do repositório base, então o branch é publicado a
        // partir da base. Sem push dentro da sessão: quem publica é este processo, agora.
        publicacao = await publicarComAprovacao(worktree.branch, getGitDiff(cwd, headInicial || undefined))
        rodape = rodapeDeEntrega(base, worktree, publicacao) + notaDoMerge()
      } else if (worktree) {
        rodape = notaSemRemoto(semRemoto) + instrucoesDeMerge(base, worktree)
      }
      const resumo = `${content}${rodape}`
      const entrega = publicacao?.ok ? publicacao.entrega : undefined
      await postar(`/agent/session/${sessionId}/complete`, {
        summary: resumo,
        previewUrl,
        ...(verificacaoDaSessao ? { testVerification: verificacaoDaSessao } : {}),
        ...(entrega ? { entrega } : {}),
      })
      // `finalizar()` remove o CHECKOUT do worktree agora — o branch (`worktree?.branch`,
      // já reportado acima) continua existindo para o merge; o campo `worktree` no retorno
      // vira só proveniência ("foi aqui"), não um diretório que ainda exista no disco.
      return finalizar({
        ok: true, sessionId, branch: worktree?.branch, worktree: worktree?.dir,
        ...(publicacao ? { publicacao } : {}),
      })
    }

    if (type === 'error') {
      await postar(`/agent/session/${sessionId}/error`, { message: content })
      return finalizar({ ok: false, sessionId })
    }

    // A04: saída sem marcador reconhecido NÃO é conclusão.
    //
    // Até 13/09 bastava passar de 50 caracteres para virar `complete` com `ok: true` — e o P6
    // da auditoria reproduziu exatamente isso com texto aleatório. Tamanho de texto nunca foi
    // evidência de trabalho feito: o protocolo pede um marcador em linha própria, e a ausência
    // dele significa que a sessão não declarou o que fez, não que terminou bem.
    //
    // O que já foi produzido continua alcançável pelo branch — isto encerra a sessão como
    // indeterminada, não descarta trabalho.
    if (output.trim().length > 0) {
      const onde = worktree ? ` O que foi produzido está no branch \`${worktree.branch}\`.` : ''
      await postar(`/agent/session/${sessionId}/error`, {
        message:
          'A sessão terminou sem declarar conclusão: nenhum marcador do protocolo ' +
          `([[RAYZEN:DONE]], [[RAYZEN:STEP_DONE]], [[RAYZEN:QUESTION]] ou [[RAYZEN:ERROR]]) ` +
          `apareceu na última resposta.${onde}\n\n---\nÚltima saída:\n${output.slice(-500)}`,
      })
      return finalizar({ ok: false, sessionId, motivo: 'sem_marcador_de_protocolo' })
    }
  }

  await postar(`/agent/session/${sessionId}/error`, { message: 'Número máximo de iterações atingido.' })
  return finalizar({ ok: false, sessionId })
}
