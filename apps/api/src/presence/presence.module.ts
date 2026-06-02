import { Module } from '@nestjs/common';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

/**
 * Presença online + histórico de conexão. PrismaService e ChatGateway são
 * providos globalmente (PrismaModule / GatewayModule @Global), então não há
 * imports aqui.
 */
@Module({
  controllers: [PresenceController],
  providers: [PresenceService],
})
export class PresenceModule {}
