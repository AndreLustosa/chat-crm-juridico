import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { AuthModule } from '../auth/auth.module';

/**
 * SaaS Fase 1 — cadastro público (trial 15d) + leitura de assinatura.
 *
 * O SubscriptionGuard (trava de acesso) é registrado GLOBALMENTE em
 * AppModule (APP_GUARD), não aqui — ele só depende de PrismaService (global)
 * e Reflector.
 *
 * Importa AuthModule para reusar AuthService.login (auto-login pós-cadastro).
 * PrismaService é global (PrismaModule @Global).
 */
@Module({
  imports: [AuthModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
})
export class SubscriptionModule {}
