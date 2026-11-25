import { Injectable } from '@nestjs/common'

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditStatus = 'generated' | 'human_reviewed' | 'human_edited' | 'locked'

export interface MergeResult {
  contentMd: string
  diff: string
  skipped: boolean
  skipReason?: string
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WikiMergeService {

  /**
   * Returns true when the pipeline can safely overwrite the note.
   * human_edited and locked require explicit human action to recompile.
   */
  canOverwrite(editStatus: EditStatus): boolean {
    return editStatus === 'generated' || editStatus === 'human_reviewed'
  }

  /**
   * Computes a human-readable summary of changes between two markdown strings.
   * Compares at the line level.
   */
  computeDiff(oldMd: string, newMd: string): string {
    const oldLines = new Set(oldMd.split('\n').map((l) => l.trim()).filter(Boolean))
    const newLines = newMd.split('\n').map((l) => l.trim()).filter(Boolean)

    const added = newLines.filter((l) => !oldLines.has(l)).length
    const removed = Array.from(oldLines).filter((l) => !newLines.includes(l)).length

    if (added === 0 && removed === 0) return 'sem alterações'
    const parts: string[] = []
    if (added > 0) parts.push(`+${added} linha${added > 1 ? 's' : ''}`)
    if (removed > 0) parts.push(`-${removed} linha${removed > 1 ? 's' : ''}`)
    return parts.join(', ')
  }

  /**
   * Attempts to merge a new LLM draft into the existing note content.
   * Respects editStatus: blocks overwrite for human_edited and locked.
   */
  merge(
    currentContentMd: string,
    draftContentMd: string,
    editStatus: EditStatus,
    force = false,
  ): MergeResult {
    if (!force && !this.canOverwrite(editStatus)) {
      return {
        contentMd: currentContentMd,
        diff: 'bloqueado',
        skipped: true,
        skipReason: `editStatus="${editStatus}" — edição humana protegida. Use force=true para forçar recompilação.`,
      }
    }

    const diff = this.computeDiff(currentContentMd, draftContentMd)

    // Se não há mudanças, não cria nova versão
    if (diff === 'sem alterações') {
      return { contentMd: currentContentMd, diff, skipped: true, skipReason: 'sem alterações' }
    }

    return { contentMd: draftContentMd, diff, skipped: false }
  }
}
