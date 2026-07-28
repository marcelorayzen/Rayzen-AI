import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { SyncService } from './sync.service'

@Processor('catalog-sync')
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name)

  constructor(private readonly syncService: SyncService) {
    super()
  }

  async process(_job: Job): Promise<{ assets: number; edges: number }> {
    this.logger.log('Iniciando sync periódico do catálogo')
    return this.syncService.syncOnce()
  }
}
