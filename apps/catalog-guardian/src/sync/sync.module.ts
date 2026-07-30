import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { BullModule } from '@nestjs/bullmq'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { CoreModule } from '../core/core.module'
import { AdaptersModule } from '../adapters/adapters.module'
import { EmbeddingModule } from '../embedding/embedding.module'
import { SyncService } from './sync.service'
import { SyncProcessor } from './sync.processor'

const SYNC_INTERVAL_MS = 15 * 60 * 1000 // 15 min — ajustável via CATALOG_SYNC_INTERVAL_MS

@Module({
  imports: [
    CoreModule,
    AdaptersModule,
    EmbeddingModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({ name: 'catalog-sync' }),
  ],
  providers: [SyncService, SyncProcessor],
  exports: [SyncService],
})
export class SyncModule implements OnModuleInit {
  constructor(
    @InjectQueue('catalog-sync') private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const intervalMs = this.config.get<number>('CATALOG_SYNC_INTERVAL_MS', SYNC_INTERVAL_MS)
    await this.queue.upsertJobScheduler('catalog-sync-recurring', { every: intervalMs }, {
      name: 'sync',
    })
  }
}
