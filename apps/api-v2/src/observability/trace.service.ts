import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaV2Service } from '../core/prisma-v2.service'

export interface StartSpanOptions {
  traceId:       string
  service:       string
  operation:     string
  parentSpanId?: string
  attributes?:   Record<string, unknown>
}

export interface SpanHandle {
  traceId:  string
  spanId:   string
  end(status?: 'ok' | 'error' | 'timeout', error?: string): Promise<void>
}

@Injectable()
export class TraceService {
  private readonly logger = new Logger(TraceService.name)

  constructor(private readonly prisma: PrismaV2Service) {}

  generateTraceId(): string {
    return randomUUID().replace(/-/g, '')
  }

  async startSpan(opts: StartSpanOptions): Promise<SpanHandle> {
    const spanId    = randomUUID().replace(/-/g, '')
    const startedAt = new Date()

    try {
      await this.prisma.traceSpan.create({
        data: {
          traceId:      opts.traceId,
          spanId,
          parentSpanId: opts.parentSpanId,
          service:      opts.service,
          operation:    opts.operation,
          startedAt,
          status:       'ok',
          attributes:   (opts.attributes ?? {}) as object,
        },
      })
    } catch (e) {
      this.logger.warn(`startSpan failed: ${e}`)
    }

    const self = this
    return {
      traceId: opts.traceId,
      spanId,
      async end(status = 'ok', error?: string) {
        const endedAt    = new Date()
        const durationMs = endedAt.getTime() - startedAt.getTime()
        try {
          await self.prisma.traceSpan.update({
            where: { spanId },
            data:  { endedAt, durationMs, status, error },
          })
        } catch (e) {
          self.logger.warn(`endSpan failed: ${e}`)
        }
      },
    }
  }

  async getTrace(traceId: string) {
    const spans = await this.prisma.traceSpan.findMany({
      where:   { traceId },
      orderBy: { startedAt: 'asc' },
    })
    const totalMs = spans.reduce((s, sp) => s + (sp.durationMs ?? 0), 0)
    const errors  = spans.filter((s) => s.status === 'error')
    return { traceId, spans, spanCount: spans.length, totalMs, errorCount: errors.length }
  }

  async getMissionTimeline(missionId: string) {
    const spans = await this.prisma.traceSpan.findMany({
      where:   { attributes: { path: ['missionId'], equals: missionId } },
      orderBy: { startedAt: 'asc' },
    })
    return { missionId, timeline: spans }
  }

  async getRecentErrors(limit = 20) {
    return this.prisma.traceSpan.findMany({
      where:   { status: 'error' },
      orderBy: { startedAt: 'desc' },
      take: limit,
    })
  }
}
