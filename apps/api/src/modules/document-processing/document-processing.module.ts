import { Module } from '@nestjs/common'
import { DocumentProcessingController } from './document-processing.controller'
import { DocumentProcessingService } from './document-processing.service'

@Module({
  controllers: [DocumentProcessingController],
  providers: [DocumentProcessingService],
  exports: [DocumentProcessingService],
})
export class DocumentProcessingModule {}
