import { Injectable } from '@nestjs/common'
import { ValidationResult, ValidationIssue } from '@rayzen/types'

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|context)/i,
  /you\s+are\s+now\s+(a\s+)?(?!rayzen|kai)/i,
  /jailbreak/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /override\s+(your\s+)?(instructions?|system\s+prompt)/i,
  /forget\s+(all\s+)?(previous|prior)\s+(instructions?|context)/i,
  /act\s+as\s+(?!a\s+(qa|developer|assistant))/i,
  /\[system\]/i,
  /<\|?system\|?>/i,
]

const MAX_PROMPT_LENGTH = 4000

@Injectable()
export class PromptValidator {
  validate(prompt: string): ValidationResult {
    const issues: ValidationIssue[] = []

    if (!prompt || prompt.trim().length === 0) {
      issues.push({
        type: 'schema_violation',
        severity: 'high',
        message: 'Prompt vazio não é permitido',
      })
      return { valid: false, issues, score: 0 }
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      issues.push({
        type: 'length_exceeded',
        severity: 'medium',
        message: `Prompt excede o limite de ${MAX_PROMPT_LENGTH} caracteres (recebido: ${prompt.length})`,
      })
    }

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(prompt)) {
        issues.push({
          type: 'prompt_injection',
          severity: 'high',
          message: `Padrão suspeito detectado: ${pattern.source.slice(0, 40)}...`,
        })
        break
      }
    }

    const highSeverity = issues.filter((i) => i.severity === 'high').length
    const mediumSeverity = issues.filter((i) => i.severity === 'medium').length
    const score = Math.max(0, 1 - highSeverity * 0.5 - mediumSeverity * 0.2)
    const valid = highSeverity === 0

    return { valid, issues, score }
  }
}
