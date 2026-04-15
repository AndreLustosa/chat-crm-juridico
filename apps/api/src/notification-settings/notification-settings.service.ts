import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Defaults aplicados quando o usuário não tem registro ainda */
const DEFAULT_PREFERENCES = {
  incoming_message:  { sound: true,  desktop: true,  email: false },
  transfer_request:  { sound: true,  desktop: true,  email: false },
  task_overdue:      { sound: true,  desktop: true,  email: false },
  calendar_reminder: { sound: true,  desktop: true,  email: false },
  legal_case_update: { sound: false, desktop: true,  email: false },
  petition_status:   { sound: false, desktop: true,  email: false },
  contract_signed:   { sound: true,  desktop: true,  email: false },
  connection_status: { sound: false, desktop: false, email: false },
};

export type NotifPreferences = typeof DEFAULT_PREFERENCES;
export type NotifEventType = keyof NotifPreferences;

@Injectable()
export class NotificationSettingsService {
  private readonly logger = new Logger(NotificationSettingsService.name);

  /** Cache em memória: userId → settings (TTL 60s) */
  private cache = new Map<string, { data: any; expiresAt: number }>();
  private static readonly CACHE_TTL = 60_000;

  constructor(private prisma: PrismaService) {}

  /** Retorna settings do usuário (cria com defaults se não existe) */
  async getOrCreate(userId: string) {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    let setting = await (this.prisma as any).notificationSetting.findUnique({
      where: { user_id: userId },
    });

    if (!setting) {
      setting = await (this.prisma as any).notificationSetting.create({
        data: {
          user_id: userId,
          sound_id: 'ding',
          preferences: DEFAULT_PREFERENCES,
        },
      });
      this.logger.log(`[NotifSettings] Criado registro default para user ${userId}`);
    }

    // Garante que preferences tem todos os tipos (merge com defaults para novos tipos)
    const merged = { ...DEFAULT_PREFERENCES, ...(setting.preferences as any) };
    setting.preferences = merged;

    this.cache.set(userId, { data: setting, expiresAt: Date.now() + NotificationSettingsService.CACHE_TTL });
    return setting;
  }

  /** Atualiza preferences, sound_id e/ou muted_until */
  async update(userId: string, data: {
    preferences?: Partial<NotifPreferences>;
    sound_id?: string;
    muted_until?: string | null;
  }) {
    const current = await this.getOrCreate(userId);

    const updateData: any = {};

    if (data.preferences) {
      // Merge parcial: só atualiza os tipos enviados
      const merged = { ...(current.preferences as any), ...data.preferences };
      updateData.preferences = merged;
    }

    if (data.sound_id !== undefined) {
      updateData.sound_id = data.sound_id;
    }

    if (data.muted_until !== undefined) {
      updateData.muted_until = data.muted_until ? new Date(data.muted_until) : null;
    }

    const updated = await (this.prisma as any).notificationSetting.update({
      where: { user_id: userId },
      data: updateData,
    });

    // Invalida cache
    this.cache.delete(userId);

    return updated;
  }

  /**
   * Verifica se um evento deve tocar som/desktop para o usuário.
   * Usado pelo ChatGateway antes de emitir para incluir _prefs no payload.
   */
  async getNotifFlags(userId: string, eventType: NotifEventType): Promise<{
    skipSound: boolean;
    skipDesktop: boolean;
  }> {
    const settings = await this.getOrCreate(userId);

    // DND ativo: pula tudo
    if (settings.muted_until && new Date(settings.muted_until) > new Date()) {
      return { skipSound: true, skipDesktop: true };
    }

    const prefs = (settings.preferences as any)?.[eventType];
    if (!prefs) {
      // Tipo desconhecido: usa defaults (tudo ligado)
      return { skipSound: false, skipDesktop: false };
    }

    return {
      skipSound: !prefs.sound,
      skipDesktop: !prefs.desktop,
    };
  }

  /** Retorna o sound_id preferido do usuário */
  async getSoundId(userId: string): Promise<string> {
    const settings = await this.getOrCreate(userId);
    return settings.sound_id || 'ding';
  }
}
