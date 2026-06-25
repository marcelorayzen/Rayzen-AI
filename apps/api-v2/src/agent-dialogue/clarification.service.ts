import { Injectable, Logger } from '@nestjs/common'
import { LlmService } from '../llm/llm.service'

export interface ClarificationCheck {
  needsClarification: false
}

export interface ClarificationRequired {
  needsClarification: true
  question:   string
  confidence: number
}

export type ClarificationResult = ClarificationCheck | ClarificationRequired

// Limiar abaixo do qual o agente pede esclarecimento antes de agir
const CONFIDENCE_THRESHOLD = 0.75

@Injectable()
export class ClarificationService {
  private readonly logger = new Logger(ClarificationService.name)

  constructor(private readonly llm: LlmService) {}

  /**
   * Analisa se a tarefa tem ambiguidades suficientes para justificar uma pergunta
   * antes de spawnar o specialist. Retorna a pergunta cirúrgica se necessário.
   * Ignora steps que já têm uma resposta de clarification (evita loop infinito).
   */
  async checkTask(task: string, context: string): Promise<ClarificationResult> {
    if (task.length < 15) return { needsClarification: false }

    try {
      const res = await this.llm.chat(
        [
          {
            role: 'system',
            content: `You are a task clarity evaluator. Given a task description and context, determine if the task is specific enough to be executed without human clarification.

Return ONLY valid JSON (no markdown, no explanation):
{
  "confidence": <float 0.0-1.0>,
  "ambiguities": [<string>, ...],
  "question": "<one focused question to resolve the main ambiguity, in Portuguese, or null if task is clear>"
}

Rules:
- confidence >= 0.75 means task is clear enough to proceed
- confidence < 0.75 means clarification is needed
- question must be the MOST IMPORTANT single question (not a list)
- question must be in Brazilian Portuguese
- If confidence >= 0.75, set question to null

Known internal system terms — do NOT ask for clarification on these:
- prevOutputs: the output/results from previous steps in the same mission (injected automatically)
- dependsOn: internal list of step IDs that must complete before this step
- missionId, stepId, projectId: internal system identifiers
- clarificationAnswer: the user's response to a previous clarification question
- specialist: the AI agent responsible for executing this step
- synthesizer, coder, reviewer, researcher, debugger, architect: specialist types`,
          },
          {
            role: 'user',
            content: `TASK:\n${task.slice(0, 800)}\n\nCONTEXT:\n${(context || 'none').slice(0, 400)}`,
          },
        ],
        { model: 'gpt-4o-mini', temperature: 0, maxTokens: 256 },
      )

      const raw   = res.content.replace(/```json|```/g, '').trim()
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) return { needsClarification: false }

      const parsed = JSON.parse(match[0]) as { confidence: number; question: string | null }
      const confidence = Math.min(1, Math.max(0, parsed.confidence ?? 1))

      if (confidence >= CONFIDENCE_THRESHOLD || !parsed.question) {
        return { needsClarification: false }
      }

      this.logger.log(`Task confidence=${confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD} — clarification needed`)
      return { needsClarification: true, question: parsed.question, confidence }
    } catch (e) {
      // Em caso de falha do LLM, permite continuar (fail-open)
      this.logger.warn(`ClarificationService.checkTask failed: ${e} — proceeding without check`)
      return { needsClarification: false }
    }
  }
}
