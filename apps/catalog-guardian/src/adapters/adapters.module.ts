import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CATALOG_ADAPTER, CatalogAdapter } from './catalog-adapter.interface'
import { OpenMetadataAdapter } from './openmetadata.adapter'
import { UnityCatalogAdapter } from './unitycatalog.adapter'

// Fase 6 do roadmap — CATALOG_ADAPTER escolhido em runtime via env var, não
// no código. Isso é o argumento comercial de "não é lock-in" de verdade: um
// cliente troca de catálogo fonte só editando .env, sem recompilar nada do
// resto do app (PermissionGuardService, QueryService, SyncService etc. só
// conhecem a interface CatalogAdapter, nunca a implementação concreta).
@Module({
  providers: [
    OpenMetadataAdapter,
    UnityCatalogAdapter,
    {
      provide: CATALOG_ADAPTER,
      useFactory: (config: ConfigService, omd: OpenMetadataAdapter, uc: UnityCatalogAdapter): CatalogAdapter =>
        config.get<string>('CATALOG_SOURCE', 'openmetadata') === 'unity_catalog' ? uc : omd,
      inject: [ConfigService, OpenMetadataAdapter, UnityCatalogAdapter],
    },
  ],
  exports: [CATALOG_ADAPTER],
})
export class AdaptersModule {}
