import { Module, forwardRef } from '@nestjs/common';
import { FunnelsController } from './funnels.controller';
import { FunnelsService } from './funnels.service';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { GatewayModule } from '../gateway/gateway.module';

/**
 * CRM Dinâmico — funis (pipelines) configuráveis por tenant + deals
 * (oportunidades) que percorrem as etapas. Atende a Fase 2 do roadmap:
 * REST CRUD completo. Não inclui ainda a integração com IA (worker) nem
 * frontend kanban — vide fases 3 e 4.
 */
@Module({
  imports: [forwardRef(() => GatewayModule)],
  controllers: [FunnelsController, DealsController],
  providers: [FunnelsService, DealsService],
  exports: [FunnelsService, DealsService],
})
export class CrmModule {}
