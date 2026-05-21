import { ParsedBlueprint, ParsedSection, ParsedTask } from './blueprint-markdown.parser'

interface JsonSection {
  title?: string
  slug?: string
  content?: string
  level?: number
}

interface JsonTask {
  title?: string
  status?: string
  priority?: string
}

interface JsonBlueprintInput {
  title?: string
  sections?: JsonSection[]
  tasks?: JsonTask[]
  nextSteps?: string[]
  decisions?: string[]
  problems?: string[]
}

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

export function parseJson(content: string, blueprintTitle: string): ParsedBlueprint {
  let raw: JsonBlueprintInput

  try {
    raw = JSON.parse(content) as JsonBlueprintInput
  } catch {
    throw new Error('Conteúdo JSON inválido: não foi possível fazer o parse.')
  }

  const sections: ParsedSection[] = (raw.sections ?? [])
    .filter((s) => typeof s.title === 'string' && s.title.trim())
    .map((s) => ({
      title: s.title!.trim(),
      slug: s.slug?.trim() || toSlug(s.title!.trim()),
      content: s.content?.trim() ?? '',
      level: typeof s.level === 'number' ? s.level : 2,
    }))

  const tasks: ParsedTask[] = (raw.tasks ?? [])
    .filter((t) => typeof t.title === 'string' && t.title.trim())
    .map((t) => ({
      title: t.title!.trim(),
      status: 'pending' as const,
      priority: 'medium' as const,
    }))

  const nextSteps = (raw.nextSteps ?? []).filter((s) => typeof s === 'string' && s.trim())
  const decisions = (raw.decisions ?? []).filter((s) => typeof s === 'string' && s.trim())
  const problems = (raw.problems ?? []).filter((s) => typeof s === 'string' && s.trim())

  return {
    title: blueprintTitle,
    sections,
    tasks,
    nextSteps,
    decisions,
    problems,
  }
}
