import { SetMetadata } from '@nestjs/common';

/**
 * Marca uma rota como ISENTA da trava de assinatura (SubscriptionGuard).
 *
 * Use em rotas que precisam funcionar MESMO com o trial/assinatura vencidos —
 * caso contrário o usuário ficaria preso sem conseguir ver o status nem pagar:
 *   - GET /me/subscription (precisa mostrar a tela de bloqueio)
 *   - rotas de checkout/pagamento (Fase 2 — para reativar a conta)
 *   - logout
 *
 * Rotas @Public() já são ignoradas pelo guard automaticamente.
 */
export const SUBSCRIPTION_EXEMPT_KEY = 'subscriptionExempt';
export const SubscriptionExempt = () => SetMetadata(SUBSCRIPTION_EXEMPT_KEY, true);
