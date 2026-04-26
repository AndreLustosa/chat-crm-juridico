import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ClientJwtAuthGuard } from '../portal-auth/client-jwt-auth.guard';
import { CurrentClient } from '../portal-auth/current-client.decorator';
import type { ClientUser } from '../portal-auth/current-client.decorator';
import { PortalContractsService } from './portal-contracts.service';

@Controller('portal/contracts')
export class PortalContractsController {
  constructor(private readonly service: PortalContractsService) {}

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get()
  async list(@CurrentClient() client: ClientUser) {
    return this.service.list(client.id);
  }
}
