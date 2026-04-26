import { Module } from '@nestjs/common';
import { PortalProcessesService } from './portal-processes.service';
import { PortalProcessesController } from './portal-processes.controller';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';

/**
 * Modulo de processos do portal — depende de PortalAuthModule pra ter acesso
 * ao ClientJwtAuthGuard (validacao do cookie portal_token + tipagem do
 * cliente autenticado).
 */
@Module({
  imports: [PortalAuthModule],
  providers: [PortalProcessesService],
  controllers: [PortalProcessesController],
})
export class PortalProcessesModule {}
