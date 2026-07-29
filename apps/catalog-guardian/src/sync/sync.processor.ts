import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { SyncService } from './sync.service'

@Processor('catalog-sync')
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name)

  constructor(private readonly syncService: SyncService) {
    super()
  }

  async process(_job: Job): Promise<{ assets: number; edges: number; glossaryTerms: number }> {
    this.logger.log('Iniciando sync periódico do catálogo')
    return this.syncService.syncOnce()
  }

  // Item 7: sem isso, um job de sync que falha (catálogo fonte fora do ar,
  // token expirado etc.) ficava completamente silencioso — o worker do
  // BullMQ engolia a falha e o próximo ciclo agendado simplesmente tentava
  // de novo, sem nenhum log de que algo deu errado entre uma tentativa e
  // outra.
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job de sync ${job.id} falhou: ${error.message}`, error.stack)
  }
}
