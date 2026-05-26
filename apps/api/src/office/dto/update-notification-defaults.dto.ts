import { IsBoolean } from 'class-validator';

/**
 * Padrão do escritório para o aviso de "tarefa vencida" (menu Configurações >
 * Escritório, só ADMIN). Os 3 canais são obrigatórios — o atendente pode
 * sobrescrever individualmente cada um (tri-state) nas preferências dele.
 * Salvo em Tenant.notification_defaults.taskOverdue (merge, preservando outras chaves).
 */
export class UpdateNotificationDefaultsDto {
  @IsBoolean()
  whatsapp!: boolean;

  @IsBoolean()
  badge!: boolean;

  @IsBoolean()
  sound!: boolean;
}
