export interface ParsedSection {
  title: string
  slug: string
  content: string
  level: number
}

export interface ParsedTask {
  title: string
  status: 'pending'
  priority: 'medium'
}

// `pareceDecisao` mora em `common/` desde 18/09: a conversa do HUB faz a mesma pergunta, e duas
// cópias da mesma regra é a família de drift que esta casa já pagou com `SAFE_ROOTS`.
import { pareceDecisao } from '../../../common/decisao-declarada.const'

export interface ParsedBlueprint {
  title: string
  sections: ParsedSection[]
  tasks: ParsedTask[]
  nextSteps: string[]
  decisions: string[]
  problems: string[]
}

const PROBLEM_PATTERNS = [
  /\bblocker\b/i,
  /\bproblema\b/i,
  /\bissue\b/i,
  /\berro\b/i,
  /\bfailing\b/i,
  /\bquebrando\b/i,
  /\bnão funciona\b/i,
]

const ACTION_VERB_PATTERNS = [
  /^(criar|implementar|adicionar|refatorar|corrigir|migrar|integrar|configurar|remover|atualizar|testar|validar|revisar|documentar)\b/i,
  /^(create|implement|add|refactor|fix|migrate|integrate|configure|remove|update|test|validate|review|document)\b/i,
]

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

function isActionItem(line: string): boolean {
  const clean = line.replace(/^[-*\d.]+\s*/, '').trim()
  return ACTION_VERB_PATTERNS.some((p) => p.test(clean))
}

/**
 * Negação que precede o verbo de decisão, dentro de uma janela curta.
 *
 * A janela existe para não condenar a linha inteira: em
 * "Decidimos manter onDelete: SetNull porque apagar projeto não deve apagar o registro"
 * há um "não" — mas depois do verbo, e a decisão é real. Só nega o que vem ANTES.
 *
 * `\p{L}` em vez de `\w` porque a janela pode conter acento ("ainda não foi aprovado").
 */

function isProblem(line: string): boolean {
  return PROBLEM_PATTERNS.some((p) => p.test(line))
}

export function parseMarkdown(content: string, blueprintTitle: string): ParsedBlueprint {
  const lines = content.split('\n')
  const sections: ParsedSection[] = []
  const tasks: ParsedTask[] = []
  const nextSteps: string[] = []
  const decisions: string[] = []
  const problems: string[] = []

  let currentSection: { title: string; slug: string; level: number; lines: string[] } | null = null

  function flushSection() {
    if (!currentSection) return
    const sectionContent = currentSection.lines.join('\n').trim()
    if (sectionContent) {
      sections.push({
        title: currentSection.title,
        slug: currentSection.slug,
        content: sectionContent,
        level: currentSection.level,
      })
    }
  }

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/)
    const h2 = line.match(/^##\s+(.+)/)
    const h3 = line.match(/^###\s+(.+)/)
    const listItem = line.match(/^[-*]\s+(.+)/) ?? line.match(/^\d+\.\s+(.+)/)

    if (h2 || h3) {
      flushSection()
      const heading = h2 ? h2[1] : h3![1]
      const level = h2 ? 2 : 3
      currentSection = { title: heading, slug: toSlug(heading), level, lines: [] }
      continue
    }

    if (h1) {
      flushSection()
      currentSection = null
      continue
    }

    if (currentSection) {
      currentSection.lines.push(line)
    }

    if (listItem) {
      const item = listItem[1].trim()

      if (pareceDecisao(item)) {
        decisions.push(item)
      } else if (isProblem(item)) {
        problems.push(item)
      } else if (isActionItem(item)) {
        nextSteps.push(item)
        tasks.push({ title: item, status: 'pending', priority: 'medium' })
      }
    }
  }

  flushSection()

  return {
    title: blueprintTitle,
    sections,
    tasks,
    nextSteps,
    decisions,
    problems,
  }
}
