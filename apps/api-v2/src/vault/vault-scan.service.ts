import { Injectable } from '@nestjs/common'

export interface ScanMatch {
  pattern: string
  line:    number
  excerpt: string  // redacted excerpt — never the full secret
}

export interface ScanResult {
  safe:    boolean
  matches: ScanMatch[]
}

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'OpenAI key',        regex: /sk-[a-zA-Z0-9]{32,}/g },
  { name: 'Groq key',          regex: /gsk_[a-zA-Z0-9]{32,}/g },
  { name: 'Anthropic key',     regex: /sk-ant-[a-zA-Z0-9_-]{32,}/g },
  { name: 'JWT token',         regex: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g },
  { name: 'Connection string', regex: /postgresql:\/\/[^@\s]+@[^\s]+/g },
  { name: 'Private IP/URL',    regex: /(?:https?:\/\/)?(?:\d{1,3}\.){3}\d{1,3}(?::\d+)/g },
  { name: 'Private key block', regex: /-----BEGIN [A-Z ]+ KEY-----/g },
  { name: 'GitHub token',      regex: /ghp_[a-zA-Z0-9]{36}/g },
  { name: 'AWS key',           regex: /AKIA[0-9A-Z]{16}/g },
]

@Injectable()
export class VaultScanService {
  scan(text: string): ScanResult {
    const matches: ScanMatch[] = []
    const lines = text.split('\n')

    for (let i = 0; i < lines.length; i++) {
      for (const { name, regex } of SECRET_PATTERNS) {
        regex.lastIndex = 0
        const m = regex.exec(lines[i])
        if (m) {
          matches.push({
            pattern: name,
            line:    i + 1,
            excerpt: lines[i].slice(0, 20).replace(/./g, '*') + '...',
          })
        }
      }
    }

    return { safe: matches.length === 0, matches }
  }

  scanObject(obj: unknown, path = ''): ScanResult {
    const matches: ScanMatch[] = []
    const traverse = (v: unknown, p: string) => {
      if (typeof v === 'string') {
        const result = this.scan(v)
        for (const m of result.matches) {
          matches.push({ ...m, pattern: `${m.pattern} at ${p}` })
        }
      } else if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) {
          traverse(val, `${p}.${k}`)
        }
      }
    }
    traverse(obj, path || 'root')
    return { safe: matches.length === 0, matches }
  }
}
