import { spawn } from 'child_process'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const API_URL = process.env.AGENT_API_URL ?? 'http://localhost:3101'
const TOKEN = process.env.AGENT_TOKEN ?? ''
const MAX_ITERATIONS = 20

type AnalysisType = 'question' | 'completion' | 'error' | 'noise'

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[mGKHFJA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

function analyzeOutput(text: string): { type: AnalysisType; content: string } {
  const clean = stripAnsi(text).trim()
  if (!clean) return { type: 'noise', content: '' }

  const lastLine = clean.split('\n').filter(Boolean).at(-1) ?? ''

  const isQuestion = lastLine.endsWith('?')
    || /\b(qual|escolha|prefere|confirmar|posso|devo|quer|gostaria)\b/i.test(lastLine)
  if (isQuestion) return { type: 'question', content: clean.slice(-500) }

  const isComplete = /✅|concluí|finalizei|implementei|pronto|done|complete/i.test(clean)
    && !/erro|error|failed/i.test(clean)
  if (isComplete) return { type: 'completion', content: clean.slice(-500) }

  const isError = /\b(Error:|exception|falhou|failed|ENOENT|EACCES)\b/.test(clean)
    && !/test.*pass/i.test(clean)
  if (isError) return { type: 'error', content: clean.slice(-300) }

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

function runClaude(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.stderr.on('data', (d: Buffer) => chunks.push(d))

    proc.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8')
      if (code === 0) resolve(output)
      else reject(new Error(output || `claude exited with code ${code}`))
    })

    proc.on('error', reject)
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

  let context = prompt
  let iteration = 0

  while (iteration < MAX_ITERATIONS) {
    iteration++
    let output: string

    try {
      output = await runClaude(context, cwd)
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300)
      await apiPost(`/agent/session/${sessionId}/error`, { message: msg })
      return { ok: false, sessionId, error: msg }
    }

    const { type, content } = analyzeOutput(output)

    if (type === 'question') {
      await apiPost(`/agent/session/${sessionId}/question`, { question: content })
      const reply = await pollReply(sessionId)
      if (reply) {
        context = `${prompt}\n\n[Resposta anterior do usuário]: ${reply}\n\n[Continuar a implementação]`
      } else {
        context = `${prompt}\n\n[O usuário não respondeu a tempo — use o melhor julgamento para continuar]`
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

    // noise — if Claude exited with 0 and no recognized pattern, treat as completion
    if (output.trim().length > 50) {
      await apiPost(`/agent/session/${sessionId}/complete`, { summary: output.slice(-500) })
      return { ok: true, sessionId }
    }
  }

  await apiPost(`/agent/session/${sessionId}/error`, { message: 'Número máximo de iterações atingido.' })
  return { ok: false, sessionId }
}
