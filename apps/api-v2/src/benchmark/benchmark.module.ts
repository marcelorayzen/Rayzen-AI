import { Module } from '@nestjs/common'
import { BenchmarkService } from './benchmark.service'
import { BenchmarkController } from './benchmark.controller'
import { LlmModule } from '../llm/llm.module'

@Module({
  imports: [LlmModule],
  controllers: [BenchmarkController],
  providers: [BenchmarkService],
  exports: [BenchmarkService],
})
export class BenchmarkModule {}
