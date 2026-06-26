import { Injectable } from '@nestjs/common'
import * as path from 'path'

export interface TestGap {
  sourceFile: string
  expectedSpecFile: string
  exists: boolean
}

export interface SuggestedTest {
  file: string
  testFile: string
  reason: string
}

const TESTABLE_SUFFIXES = ['.service.ts', '.controller.ts', '.gateway.ts', '.guard.ts', '.pipe.ts', '.interceptor.ts']

// Convention: apps/api-v2/src/X/X.service.ts → apps/api-v2/src/X/__tests__/X.service.spec.ts
function inferSpecPath(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, '/')
  for (const suffix of TESTABLE_SUFFIXES) {
    if (!norm.endsWith(suffix)) continue
    const dir  = path.posix.dirname(norm)
    const base = path.posix.basename(norm, '.ts')
    return `${dir}/__tests__/${base}.spec.ts`
  }
  return null
}

@Injectable()
export class TestGapDetectorService {
  detect(changedFiles: string[], existingFiles: string[]): TestGap[] {
    const existingSet = new Set(existingFiles.map(f => f.replace(/\\/g, '/')))
    const gaps: TestGap[] = []

    for (const file of changedFiles) {
      const specPath = inferSpecPath(file)
      if (!specPath) continue
      gaps.push({ sourceFile: file, expectedSpecFile: specPath, exists: existingSet.has(specPath) })
    }

    return gaps
  }

  buildSuggestions(gaps: TestGap[]): SuggestedTest[] {
    return gaps
      .filter(g => !g.exists)
      .map(g => ({
        file:     g.sourceFile,
        testFile: g.expectedSpecFile,
        reason:   `No spec found at ${g.expectedSpecFile}`,
      }))
  }
}
