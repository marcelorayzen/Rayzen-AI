import { spawn } from 'child_process'
import { execFileSync } from 'child_process'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import {
  modoIsoladoLigado, prerequisitos, prepararWorkspace, executarNaConta,
  entregarTrabalho, instrucoesDeBundle,
} from '../exec/sessao-isolada'
// `criarWorktree`/`removerWorktree` moraram aqui até 12/09; extraídas para `exec/workspace-isolado.ts`
// quando o Item A.3 da varredura pós-plano passou a precisar do MESMO mecanismo para `run_command`.
import { criarWorktree, removerWorktree, type Worktree } from '../exec/workspace-isolado'
import { classificarResposta } from './resposta-aprovacao'
import { resolverBaseDaSessao } from './base-da-sessao'

const API_URL = process.env.AGENT_API_URL ?? 'http://localhost:3101'
const TOKEN = process.env.AGENT_TOKEN ?? ''
const MAX_ITERATIONS = 20
// Intervalo entre envios de log ao vivo: agrupa chunks para não saturar a API
const LOG_FLUSH_MS = 800

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
    let logBuffer = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flushLog = () => {
      if (!logBuffer) return
      const chunk = logBuffer
      logBuffer = ''
      // fire-and-forget — falhas de log não interrompem a execução
      apiPost(`/agent/session/${sessionId}/log`, { chunk: stripAnsi(chunk) }).catch(() => null)
    }

    const proc = spawn('claude', [
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
      logBuffer += d.toString('utf8')
      if (!flushTimer) {
        flushTimer = setTimeout(() => { flushTimer = null; flushLog() }, LOG_FLUSH_MS)
      }
    })

    proc.stderr.on('data', (d: Buffer) => {
      allChunks.push(d)
    })

    proc.on('close', (code) => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      flushLog() // flush final
      const output = Buffer.concat(allChunks).toString('utf8')
      if (code === 0) resolve(output)
      else reject(new Error(output || `claude exited with code ${code}`))
    })

    proc.on('error', (err) => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
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

export async function supervisedSession(payload: {
  sessionId: string
  prompt: string
  projectId?: string
  projectPath?: string
  previewOutputPath?: string
}) {
  const { sessionId, prompt, projectId, projectPath, previewOutputPath } = payload

  // A03: o payload enfileirado traz `projectId`, não caminho. `projectId` que não resolve
  // RECUSA a sessão — nunca cai em `process.cwd()`, que faria a sessão escrever código num
  // repositório que ninguém pediu, sem erro e sem aviso.
  const resolucao = await resolverBaseDaSessao({ projectId, projectPath })
  if ('erro' in resolucao) {
    await apiPost(`/agent/session/${sessionId}/error`, { message: resolucao.erro.slice(0, 300) })
    return { ok: false, sessionId, error: resolucao.erro }
  }
  const base = resolucao.base

  /**
   * Dois regimes, e a diferença entre eles é estrutural — não é uma opção de configuração.
   *
   * `local`: a sessão roda como o DONO, isolada por worktree. É redução de superfície, e o
   *          comentário das listas de negação já diz que não é isolamento.
   * `isolado` (Fase 4-B): outro usuário do SO, outro perfil, outro checkout. O trabalho volta
   *          por `git bundle`, nunca aparecendo no diretório de quem revisa.
   */
  const isolado = modoIsoladoLigado()
  let worktree: { dir: string; branch: string } | null = null
  let cwd = base
  let baseSha = ''

  if (isolado) {
    // Falha FECHADO. Cair de volta para o usuário do dono desfaria o isolamento exatamente
    // quando ninguém está olhando, e a sessão continuaria reportando sucesso — que é o
    // formato de mentira que esta casa já pagou três vezes num dia só (09/09).
    const problemas = prerequisitos()
    if (problemas.length > 0) {
      const msg = `Sessão isolada ligada e a conta não está pronta: ${problemas.join('; ')}`
      await apiPost(`/agent/session/${sessionId}/error`, { message: msg.slice(0, 300) })
      return { ok: false, sessionId, error: msg }
    }
    try {
      const prep = await prepararWorkspace(sessionId, base)
      baseSha = prep.base
      cwd = prep.ramo // só para o relato; nenhum comando do dono roda na árvore da conta
    } catch (err) {
      const msg = `Não consegui preparar o workspace da conta: ${(err as Error).message}`
      await apiPost(`/agent/session/${sessionId}/error`, { message: msg.slice(0, 300) })
      return { ok: false, sessionId, error: msg }
    }
  } else {
    // Isolamento por worktree. Quando não dá (não é git, ou o comando falha), roda no
    // diretório original — degradar é melhor que recusar.
    worktree = await criarWorktree(base, sessionId)
    cwd = worktree?.dir ?? base
  }

  // Item A.1 da varredura de 2026-09-12: todo `return` a partir daqui passa por aqui, então o
  // worktree (se existir) é sempre liberado — sucesso, erro, ou o fallback de iterações
  // esgotadas. `worktree` só existe no regime local (`else` acima); no isolado é sempre `null`
  // e a chamada abaixo não faz nada.
  const finalizar = async <T>(resultado: T): Promise<T> => {
    if (worktree) await removerWorktree(base, worktree)
    return resultado
  }

  const basePrompt = `${PROTOCOL}\n\n${prompt}`
  let context = basePrompt
  let iteration = 0
  // No modo isolado o diff nasce DENTRO da conta: o dono não roda git na árvore dela.
  let diffDaConta = ''

  while (iteration < MAX_ITERATIONS) {
    iteration++
    let output: string

    // Marca o início da etapa ANTES de a sessão poder commitar. No modo isolado quem faz
    // isto é o runner, dentro da conta.
    const headDaEtapa = isolado ? '' : headAtual(cwd)

    try {
      if (isolado) {
        const r = await executarNaConta(
          sessionId, context, FERRAMENTAS_PERMITIDAS, FERRAMENTAS_NEGADAS,
          (chunk) => { apiPost(`/agent/session/${sessionId}/log`, { chunk: stripAnsi(chunk) }).catch(() => null) },
        )
        if (r.codigo !== 0) throw new Error(r.saida.slice(-500) || `claude saiu com código ${r.codigo}`)
        output = r.saida
        diffDaConta = r.diff
      } else {
        output = await runClaude(context, cwd, sessionId)
      }
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300)
      await apiPost(`/agent/session/${sessionId}/error`, { message: msg })
      return finalizar({ ok: false, sessionId, error: msg })
    }

    const { type, content } = analyzeOutput(output)

    if (type === 'question') {
      await apiPost(`/agent/session/${sessionId}/question`, { question: content, requiresApproval: false })
      const reply = await pollReply(sessionId)
      if (reply) {
        context = `${basePrompt}\n\n[Resposta anterior do usuário]: ${reply}\n\n[Continuar a implementação]`
      } else {
        context = `${basePrompt}\n\n[O usuário não respondeu a tempo — use o melhor julgamento para continuar]`
      }
      continue
    }

    if (type === 'step_completed') {
      // Captura o diff desta etapa para exibição no ApprovalCard
      const diff = isolado ? diffDaConta : getGitDiff(cwd, headDaEtapa || undefined)
      const question = diff
        ? `${content}\n\n---DIFF---\n${diff}`
        : content

      await apiPost(`/agent/session/${sessionId}/question`, {
        question,
        requiresApproval: true,
        approvalOptions: ['Aprovado, continue', 'Rejeitar e corrigir', 'Modificar instrução'],
      })
      const reply = await pollReply(sessionId)
      const decisao = classificarResposta(reply)

      // A02: até 13/09 a ausência de resposta caía no ramo APROVOU, junto com `\bpode\b`
      // casando dentro de "não pode". Silêncio não é autorização — a sessão PARA, e o
      // trabalho feito até aqui continua alcançável pelo branch.
      if (decisao === 'sem_resposta') {
        const onde = worktree
          ? ` O que já foi feito está no branch \`${worktree.branch}\`.`
          : ''
        await apiPost(`/agent/session/${sessionId}/error`, {
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
      // O trabalho precisa atravessar a fronteira de conta, senão fica preso no workspace
      // dela: `marce` tem apenas leitura lá, e o git recusa operar naquela árvore.
      let rodape = ''
      if (isolado) {
        try {
          const entrega = await entregarTrabalho(sessionId, baseSha)
          rodape = instrucoesDeBundle(entrega.bundle, entrega.commits, baseSha)
        } catch (err) {
          // A sessão terminou; só a entrega falhou. Relatar isso é melhor que transformar
          // trabalho concluído em erro — mas dizer ONDE ele está é obrigatório.
          rodape = `\n\n---\nA sessão concluiu, mas a entrega do bundle falhou: ${(err as Error).message}\n` +
                   `O trabalho está no workspace da conta, no ramo \`${cwd}\`.`
        }
      } else if (worktree) {
        rodape = instrucoesDeMerge(base, worktree)
      }
      const resumo = `${content}${rodape}`
      await apiPost(`/agent/session/${sessionId}/complete`, { summary: resumo, previewUrl })
      // `finalizar()` remove o CHECKOUT do worktree agora — o branch (`worktree?.branch`,
      // já reportado acima) continua existindo para o merge; o campo `worktree` no retorno
      // vira só proveniência ("foi aqui"), não um diretório que ainda exista no disco.
      return finalizar({ ok: true, sessionId, branch: worktree?.branch ?? (isolado ? cwd : undefined), worktree: worktree?.dir })
    }

    if (type === 'error') {
      await apiPost(`/agent/session/${sessionId}/error`, { message: content })
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
      await apiPost(`/agent/session/${sessionId}/error`, {
        message:
          'A sessão terminou sem declarar conclusão: nenhum marcador do protocolo ' +
          `([[RAYZEN:DONE]], [[RAYZEN:STEP_DONE]], [[RAYZEN:QUESTION]] ou [[RAYZEN:ERROR]]) ` +
          `apareceu na última resposta.${onde}\n\n---\nÚltima saída:\n${output.slice(-500)}`,
      })
      return finalizar({ ok: false, sessionId, motivo: 'sem_marcador_de_protocolo' })
    }
  }

  await apiPost(`/agent/session/${sessionId}/error`, { message: 'Número máximo de iterações atingido.' })
  return finalizar({ ok: false, sessionId })
}
