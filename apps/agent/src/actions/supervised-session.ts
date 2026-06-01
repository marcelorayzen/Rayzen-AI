import { spawn } from 'child_process'
import { execSync } from 'child_process'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

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

/** Captura o git diff --stat HEAD (mudanças staged + unstaged vs último commit). */
function getGitDiff(cwd: string): string {
  try {
    const stat = execSync('git diff --stat HEAD', { cwd, timeout: 5000, encoding: 'utf8' }).trim()
    if (stat) return stat
    // Nenhuma mudança vs HEAD — tenta status short (arquivos não-tracked)
    return execSync('git status --short', { cwd, timeout: 5000, encoding: 'utf8' }).trim()
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

    const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      cwd,
      env: { ...process.env },
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
  projectPath?: string
  previewOutputPath?: string
}) {
  const { sessionId, prompt, projectPath, previewOutputPath } = payload
  const cwd = projectPath ?? process.cwd()

  const basePrompt = `${PROTOCOL}\n\n${prompt}`
  let context = basePrompt
  let iteration = 0

  while (iteration < MAX_ITERATIONS) {
    iteration++
    let output: string

    try {
      output = await runClaude(context, cwd, sessionId)
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300)
      await apiPost(`/agent/session/${sessionId}/error`, { message: msg })
      return { ok: false, sessionId, error: msg }
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
      const diff = getGitDiff(cwd)
      const question = diff
        ? `${content}\n\n---DIFF---\n${diff}`
        : content

      await apiPost(`/agent/session/${sessionId}/question`, {
        question,
        requiresApproval: true,
        approvalOptions: ['Aprovado, continue', 'Rejeitar e corrigir', 'Modificar instrução'],
      })
      const reply = await pollReply(sessionId)

      if (!reply || /\b(aprovad|continu|ok|sim|pode)\b/i.test(reply)) {
        context = `${basePrompt}\n\n[Progresso até aqui]:\n${content}\n\n[O usuário APROVOU esta etapa. Continue com a próxima etapa.]`
      } else if (/\b(rejeit|corrig|desfa|undo|refaz|errado)\b/i.test(reply)) {
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
      await apiPost(`/agent/session/${sessionId}/complete`, { summary: content, previewUrl })
      return { ok: true, sessionId }
    }

    if (type === 'error') {
      await apiPost(`/agent/session/${sessionId}/error`, { message: content })
      return { ok: false, sessionId }
    }

    // noise — Claude saiu com 0 mas sem padrão reconhecido → trata como conclusão
    if (output.trim().length > 50) {
      await apiPost(`/agent/session/${sessionId}/complete`, { summary: output.slice(-500) })
      return { ok: true, sessionId }
    }
  }

  await apiPost(`/agent/session/${sessionId}/error`, { message: 'Número máximo de iterações atingido.' })
  return { ok: false, sessionId }
}
