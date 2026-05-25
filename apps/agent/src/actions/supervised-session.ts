import * as pty from 'node-pty'
import { createInterface } from 'readline'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const API_URL = process.env.AGENT_API_URL ?? 'http://localhost:3101'
const TOKEN = process.env.AGENT_TOKEN ?? ''

type AnalysisType = 'question' | 'completion' | 'error' | 'noise'

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[mGKHFJ]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
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

function copyPreviewFiles(outputDir: string, sessionId: string) {
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

  const term = pty.spawn('claude', ['--allowedTools', 'all'], {
    name: 'xterm-color',
    cols: 160,
    rows: 40,
    cwd,
    env: { ...process.env },
  })

  let buffer = ''
  let flushTimer: NodeJS.Timeout | null = null

  const processBuffer = async () => {
    const text = buffer
    buffer = ''
    const { type, content } = analyzeOutput(text)

    if (type === 'question') {
      await apiPost(`/agent/session/${sessionId}/question`, { question: content })
      const reply = await pollReply(sessionId)
      if (reply) {
        term.write(reply + '\n')
      } else {
        term.write('sem resposta — continue com o melhor julgamento\n')
      }
    } else if (type === 'completion') {
      let previewUrl: string | undefined
      if (previewOutputPath) {
        const destDir = copyPreviewFiles(previewOutputPath, sessionId)
        if (destDir) {
          const vpsIp = process.env.VPS_PUBLIC_IP ?? ''
          previewUrl = vpsIp ? `http://${vpsIp}/preview/${sessionId}/index.html` : undefined
        }
      }
      await apiPost(`/agent/session/${sessionId}/complete`, { summary: content, previewUrl })
      term.kill()
    } else if (type === 'error') {
      await apiPost(`/agent/session/${sessionId}/error`, { message: content })
      term.kill()
    }
  }

  term.onData((data) => {
    buffer += data
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(processBuffer, 2000)
  })

  // Inject initial prompt
  term.write(prompt + '\n')

  return new Promise<{ ok: boolean; sessionId: string }>((resolve) => {
    term.onExit(({ exitCode }) => {
      if (flushTimer) clearTimeout(flushTimer)
      resolve({ ok: exitCode === 0, sessionId })
    })
  })
}
