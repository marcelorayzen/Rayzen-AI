// Sync manual, sem depender da fila BullMQ/Redis — útil pra validar o
// OpenMetadataAdapter contra o sandbox antes de subir o worker completo.
// Uso: pnpm --filter catalog-guardian sync:once
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { AdaptersModule } from '../adapters/adapters.module'
import { EmbeddingModule } from '../embedding/embedding.module'
import { SyncService } from './sync.service'

@Module({
  imports: [CoreModule, AdaptersModule, EmbeddingModule],
  providers: [SyncService],
})
class SyncCliModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(SyncCliModule)
  const syncService = app.get(SyncService)
  const result = await syncService.syncOnce()
  console.log(`Sync manual concluído: ${result.assets} ativo(s), ${result.edges} edge(s), ${result.glossaryTerms} termo(s) de glossário`)
  await app.close()
}

main().catch((err) => {
  console.error('Sync manual falhou:', err)
  process.exit(1)
})
