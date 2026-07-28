import { Module } from '@nestjs/common'
import { CATALOG_ADAPTER } from './catalog-adapter.interface'
import { OpenMetadataAdapter } from './openmetadata.adapter'

@Module({
  providers: [
    OpenMetadataAdapter,
    { provide: CATALOG_ADAPTER, useExisting: OpenMetadataAdapter },
  ],
  exports: [CATALOG_ADAPTER],
})
export class AdaptersModule {}
