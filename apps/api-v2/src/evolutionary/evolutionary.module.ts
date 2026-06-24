import { Module } from '@nestjs/common'
import { EvolutionaryService } from './evolutionary.service'
import { EvolutionaryController } from './evolutionary.controller'
import { LlmModule } from '../llm/llm.module'
import { BenchmarkModule } from '../benchmark/benchmark.module'

// AiRouterModule e ApprovalGatesModule são @Global() — injetados sem import explícito.
@Module({
  imports: [LlmModule, BenchmarkModule],
  controllers: [EvolutionaryController],
  providers: [EvolutionaryService],
  exports: [EvolutionaryService],
})
export class EvolutionaryModule {}
