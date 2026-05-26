import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isAdmin } from '../common/utils/permissions.util';
import {
  resolveOverdueEffective,
  OverdueOverride,
  OverdueOfficeDefault,
} from './overdue-effective.util';

/** Defaults aplicados quando o usuário não tem registro ainda */
const DEFAULT_PREFERENCES = {
  incoming_message:  { sound: true,  desktop: true,  whatsapp: false },
  transfer_request:  { sound: true,  desktop: true,  whatsapp: false },
  task_overdue:      { sound: true,  desktop: true,  whatsapp: false },
  calendar_reminder: { sound: true,  desktop: true,  whatsapp: false },
  legal_case_update: { sound: false, desktop: true,  whatsapp: false },
  petition_status:   { sound: false, desktop: true,  whatsapp: false },
  contract_signed:   { sound: true,  desktop: true,  whatsapp: false },
  connection_status: { sound: false, desktop: false, whatsapp: false },
  new_lead:          { sound: true,  desktop: true,  whatsapp: true  },
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

  // ─── Aviso de tarefa vencida (task_overdue): 3 canais wpp/badge/sound ──────

  /** Default tri-state do override do atendente (tudo herdar). */
  private static readonly OVERDUE_OVERRIDE_DEFAULT: OverdueOverride = {
    whatsapp: null,
    badge: null,
    sound: null,
  };
  /** Default do escritório quando o tenant não configurou nada. */
  private static readonly OVERDUE_OFFICE_DEFAULT: OverdueOfficeDefault = {
    whatsapp: true,
    badge: true,
    sound: true,
  };

  /**
   * Lê o override tri-state do atendente de preferences.taskOverdueOverride,
   * normalizando para {whatsapp,badge,sound: boolean|null}. Valores ausentes
   * ou não-booleanos viram null (= herdar).
   */
  private readOverdueOverride(preferences: any): OverdueOverride {
    const raw = preferences?.taskOverdueOverride;
    const pick = (v: any): boolean | null => (typeof v === 'boolean' ? v : null);
    return {
      whatsapp: pick(raw?.whatsapp),
      badge: pick(raw?.badge),
      sound: pick(raw?.sound),
    };
  }

  /**
   * Lê o padrão do escritório de Tenant.notification_defaults.taskOverdue.
   * Valores ausentes/não-booleanos caem no default true.
   */
  private readOfficeDefault(notificationDefaults: any): OverdueOfficeDefault {
    const raw = notificationDefaults?.taskOverdue;
    const pick = (v: any): boolean =>
      typeof v === 'boolean' ? v : true;
    return {
      whatsapp: pick(raw?.whatsapp),
      badge: pick(raw?.badge),
      sound: pick(raw?.sound),
    };
  }

  /**
   * Monta o payload de overdue settings do usuário: o override dele (mine),
   * o padrão do escritório (office), o efetivo resolvido, se é admin e se tem
   * telefone cadastrado (pra UI avisar que WhatsApp não tem pra onde ir).
   */
  async getOverdueSettings(userId: string, roles?: string | string[]) {
    const setting = await this.getOrCreate(userId);

    // Busca tenant_id + phone do user pra resolver office default e hasPhone.
    const user = await (this.prisma as any).user.findUnique({
      where: { id: userId },
      select: { tenant_id: true, phone: true },
    });

    let officeRaw: any = {};
    if (user?.tenant_id) {
      const tenant = await (this.prisma as any).tenant.findUnique({
        where: { id: user.tenant_id },
        select: { notification_defaults: true },
      });
      officeRaw = tenant?.notification_defaults ?? {};
    }

    const mine = this.readOverdueOverride(setting.preferences);
    const office = this.readOfficeDefault(officeRaw);
    const effective = resolveOverdueEffective(mine, office);

    return {
      mine,
      office,
      effective,
      isAdmin: isAdmin(roles || []),
      hasPhone: !!user?.phone,
    };
  }

  /**
   * MERGE parcial do override tri-state em preferences.taskOverdueOverride.
   * Só os canais enviados são alterados (undefined = mantém); aceita
   * boolean|null por canal (null = voltar a herdar). Retorna o mesmo payload
   * do GET.
   */
  async updateOverdueOverride(
    userId: string,
    patch: { whatsapp?: boolean | null; badge?: boolean | null; sound?: boolean | null },
    roles?: string | string[],
  ) {
    const setting = await this.getOrCreate(userId);
    const current = this.readOverdueOverride(setting.preferences);

    const sanitize = (v: any): boolean | null =>
      typeof v === 'boolean' ? v : v === null ? null : undefined as any;

    const next: OverdueOverride = { ...current };
    for (const ch of ['whatsapp', 'badge', 'sound'] as const) {
      if (Object.prototype.hasOwnProperty.call(patch, ch)) {
        const s = sanitize(patch[ch]);
        if (s !== undefined) next[ch] = s;
      }
    }

    // Reaproveita update() (merge de preferences) p/ persistir só a chave
    // taskOverdueOverride, sem mexer nos outros tipos de notificação.
    await this.update(userId, {
      preferences: { taskOverdueOverride: next } as any,
    });

    return this.getOverdueSettings(userId, roles);
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
