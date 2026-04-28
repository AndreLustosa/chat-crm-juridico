import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ClientJwtAuthGuard } from '../portal-auth/client-jwt-auth.guard';
import { CurrentClient } from '../portal-auth/current-client.decorator';
import type { ClientUser } from '../portal-auth/current-client.decorator';
import { PortalPaymentsService } from './portal-payments.service';

@Controller('portal/payments')
export class PortalPaymentsController {
  constructor(private readonly service: PortalPaymentsService) {}

  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get()
  async list(@CurrentClient() client: ClientUser) {
    return this.service.list(client.id);
  }

  /**
   * Le preferencias de notificacao de cobranca do cliente.
   * Por enquanto so tem o flag de opt-out — pode crescer no futuro
   * (canal preferido, horario, etc).
   */
  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Get('preferences')
  async getPreferences(@CurrentClient() client: ClientUser) {
    return this.service.getPreferences(client.id);
  }

  /**
   * Liga/desliga lembretes de cobranca via WhatsApp.
   * Valor afeta TODOS os fluxos do PaymentReminderService:
   *   - Aviso imediato ao gerar charge
   *   - Lembrete pre-vencimento
   *   - Cobranca de atraso
   * Sem afetar outras notificacoes (movimentacoes, agendamento, etc).
   */
  @Public()
  @UseGuards(ClientJwtAuthGuard)
  @Patch('preferences')
  async updatePreferences(
    @CurrentClient() client: ClientUser,
    @Body() body: { remindersDisabled: boolean },
  ) {
    return this.service.updatePreferences(client.id, !!body.remindersDisabled);
  }
}
