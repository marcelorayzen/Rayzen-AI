import { Module } from '@nestjs/common'
import { QaScientistService } from './qa-scientist.service'
import { QaScientistController } from './qa-scientist.controller'
import { LlmModule } from '../llm/llm.module'
import { BenchmarkModule } from '../benchmark/benchmark.module'
import { EvolutionaryModule } from '../evolutionary/evolutionary.module'

// ApprovalGatesModule é @Global() — ApprovalGatesService disponível sem import explícito.
@Module({
  imports:     [LlmModule, BenchmarkModule, EvolutionaryModule],
  controllers: [QaScientistController],
  providers:   [QaScientistService],
  exports:     [QaScientistService],
})
export class QaScientistModule {}
