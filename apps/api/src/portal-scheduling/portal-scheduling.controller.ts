import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { ClientJwtAuthGuard } from '../portal-auth/client-jwt-auth.guard';
import { CurrentClient } from '../portal-auth/current-client.decorator';
import type { ClientUser } from '../portal-auth/current-client.decorator';
import { PortalSchedulingService } from './portal-scheduling.service';
import type { ConsultationModality } from './portal-scheduling.service';

const VALID_MODALITIES: ConsultationModality[] = ['LIGACAO', 'VIDEO', 'PRESENCIAL'];

@Controller('portal/scheduling')
export class PortalSchedulingController {
  constructor(private readonly service: PortalSchedulingService) {}

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get('availability')
  async availability(
    @CurrentClient() client: ClientUser,
    @Query('modality') modality?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!modality || !VALID_MODALITIES.includes(modality as ConsultationModality)) {
      throw new BadRequestException('Parametro modality eh obrigatorio: LIGACAO, VIDEO ou PRESENCIAL');
    }
    return this.service.listAvailability(client.id, modality as ConsultationModality, from, to);
  }

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 agendamentos/min/IP
  @Post()
  async create(
    @CurrentClient() client: ClientUser,
    @Body() body: { start_at: string; modality: ConsultationModality; reason: string; notes?: string },
  ) {
    return this.service.createAppointment(client.id, body);
  }

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get('my-appointments')
  async my(@CurrentClient() client: ClientUser) {
    return this.service.listMyAppointments(client.id);
  }
}
