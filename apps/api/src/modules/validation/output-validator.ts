import { Injectable } from '@nestjs/common'
import { ValidationResult, ValidationIssue } from '@rayzen/types'
import { ClassifyResult } from '../orchestrator/orchestrator.service'

const VALID_MODULES = new Set(['jarvis', 'brain', 'doc', 'content', 'system'])

const SYSTEM_PROMPT_LEAK_PATTERNS = [
  /você é um classificador de intenções/i,
  /responda apenas em json/i,
  /módulos disponíveis:/i,
  /ações do jarvis disponíveis/i,
  /formato da resposta:/i,
]

@Injectable()
export class OutputValidator {
  validateOutput(output: string, expectJson = false): ValidationResult {
    const issues: ValidationIssue[] = []

    if (expectJson) {
      try {
        JSON.parse(output)
      } catch {
        issues.push({
          type: 'schema_violation',
          severity: 'high',
          message: 'Saída esperada como JSON mas não é JSON válido',
        })
      }
    }

    for (const pattern of SYSTEM_PROMPT_LEAK_PATTERNS) {
      if (pattern.test(output)) {
        issues.push({
          type: 'output_hallucination',
          severity: 'high',
          message: 'Possível vazamento de system prompt detectado na saída',
        })
        break
      }
    }

    const highSeverity = issues.filter((i) => i.severity === 'high').length
    const score = Math.max(0, 1 - highSeverity * 0.5)
    const valid = highSeverity === 0

    return { valid, issues, score }
  }

  validateClassification(result: ClassifyResult): ValidationResult {
    const issues: ValidationIssue[] = []

    if (!VALID_MODULES.has(result.module)) {
      issues.push({
        type: 'schema_violation',
        severity: 'high',
        message: `Módulo inválido retornado pelo classificador: "${result.module}"`,
      })
    }

    if (result.confidence < 0.4) {
      issues.push({
        type: 'output_hallucination',
        severity: 'medium',
        message: `Confiança abaixo do threshold mínimo: ${result.confidence.toFixed(2)} (mínimo: 0.4)`,
      })
    }

    const highSeverity = issues.filter((i) => i.severity === 'high').length
    const score = Math.max(0, result.confidence - highSeverity * 0.5)
    const valid = highSeverity === 0

    return { valid, issues, score }
  }
}
