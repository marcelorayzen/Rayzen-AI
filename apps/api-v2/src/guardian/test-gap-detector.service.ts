import { Injectable } from '@nestjs/common'
import * as path from 'path'

export type TestGapType   = 'service' | 'controller' | 'use-case' | 'module'
export type TestGapReason = 'missing_spec' | 'spec_outdated' | 'no_coverage' | 'business_rule_changed'

export interface TestGap {
  sourceFile:       string
  expectedSpecFile: string
  exists:           boolean
  type:             TestGapType
  reason:           TestGapReason
}

export interface SuggestedTest {
  file:     string
  testFile: string
  reason:   string
}

const SUFFIX_TYPE_MAP: Array<{ suffix: string; type: TestGapType }> = [
  { suffix: '.service.ts',     type: 'service'     },
  { suffix: '.controller.ts',  type: 'controller'  },
  { suffix: '.gateway.ts',     type: 'service'     },
  { suffix: '.guard.ts',       type: 'service'     },
  { suffix: '.pipe.ts',        type: 'service'     },
  { suffix: '.interceptor.ts', type: 'service'     },
]

// Convention: apps/api-v2/src/X/X.service.ts → apps/api-v2/src/X/__tests__/X.service.spec.ts
function inferSpec(filePath: string): { specPath: string; type: TestGapType } | null {
  const norm = filePath.replace(/\\/g, '/')
  for (const { suffix, type } of SUFFIX_TYPE_MAP) {
    if (!norm.endsWith(suffix)) continue
    const dir  = path.posix.dirname(norm)
    const base = path.posix.basename(norm, '.ts')
    return { specPath: `${dir}/__tests__/${base}.spec.ts`, type }
  }
  return null
}

@Injectable()
export class TestGapDetectorService {
  detect(changedFiles: string[], existingFiles: string[]): TestGap[] {
    const existingSet = new Set(existingFiles.map(f => f.replace(/\\/g, '/')))
    const gaps: TestGap[] = []

    for (const file of changedFiles) {
      const inferred = inferSpec(file)
      if (!inferred) continue
      const exists = existingSet.has(inferred.specPath)
      gaps.push({
        sourceFile:       file,
        expectedSpecFile: inferred.specPath,
        exists,
        type:   inferred.type,
        reason: exists ? 'no_coverage' : 'missing_spec',
      })
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
