import { Injectable, BadRequestException } from '@nestjs/common'
import { ValidationResult } from '@rayzen/types'
import { PromptValidator } from './prompt-validator'
import { OutputValidator } from './output-validator'
import { ClassifyResult } from '../orchestrator/orchestrator.service'

@Injectable()
export class ValidationService {
  constructor(
    private promptValidator: PromptValidator,
    private outputValidator: OutputValidator,
  ) {}

  validatePrompt(prompt: string): ValidationResult {
    return this.promptValidator.validate(prompt)
  }

  validateOutput(output: string, expectJson = false): ValidationResult {
    return this.outputValidator.validateOutput(output, expectJson)
  }

  validateClassification(result: ClassifyResult): ValidationResult {
    return this.outputValidator.validateClassification(result)
  }

  assertValidPrompt(prompt: string): void {
    const result = this.promptValidator.validate(prompt)
    if (!result.valid) {
      const highIssues = result.issues.filter((i) => i.severity === 'high')
      throw new BadRequestException(highIssues[0]?.message ?? 'Prompt inválido')
    }
  }
}
