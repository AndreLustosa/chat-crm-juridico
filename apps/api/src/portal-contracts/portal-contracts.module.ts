import { Module } from '@nestjs/common';
import { PortalContractsService } from './portal-contracts.service';
import { PortalContractsController } from './portal-contracts.controller';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';

@Module({
  imports: [PortalAuthModule],
  providers: [PortalContractsService],
  controllers: [PortalContractsController],
})
export class PortalContractsModule {}
