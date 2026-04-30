import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Notifica alertas via canais configurados em TrafficSettings:
 *   - In-app (sino do CRM): cria Notification pra cada admin do tenant
 *   - Email: SMTP configurado em GlobalSetting (reusa SettingsService)
 *
 * Marca TrafficAlert.notified_at quando dispara, evitando notificar de novo
 * caso evaluator rode antes do admin processar.
 */
@Injectable()
export class TrafegoAlertNotifierService {
  private readonly logger = new Logger(TrafegoAlertNotifierService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  /** Notifica os alertas dados pelos seus IDs. */
  async notifyAlerts(alertIds: string[]) {
    if (alertIds.length === 0) return;

    const alerts = await this.prisma.trafficAlert.findMany({
      where: { id: { in: alertIds }, notified_at: null },
      include: { tenant: { select: { id: true } } },
    });
    if (alerts.length === 0) return;

    // Agrupa por tenant pra ler settings 1x e admins 1x por tenant
    const byTenant = new Map<string, typeof alerts>();
    for (const a of alerts) {
      const list = byTenant.get(a.tenant_id) ?? [];
      list.push(a);
      byTenant.set(a.tenant_id, list);
    }

    for (const [tenantId, tenantAlerts] of byTenant) {
      await this.notifyForTenant(tenantId, tenantAlerts);
    }
  }

  private async notifyForTenant(
    tenantId: string,
    alerts: Awaited<ReturnType<typeof this.prisma.trafficAlert.findMany>>,
  ) {
    const tSettings = await this.prisma.trafficSettings.findUnique({
      where: { tenant_id: tenantId },
    });

    const wantInapp = tSettings?.notify_inapp ?? true;
    const wantEmail = tSettings?.notify_email ?? true;

    // Recipients: admins do tenant. ADVOGADO pode tambem ser util mas
    // alertas operacionais sao mais responsabilidade do ADMIN.
    const admins = await this.prisma.user.findMany({
      where: {
        tenant_id: tenantId,
        roles: { has: 'ADMIN' },
      },
      select: { id: true, email: true, name: true },
    });

    if (admins.length === 0) {
      this.logger.warn(
        `[ALERT_NOTIFY] Tenant ${tenantId} sem ADMIN — alertas nao notificados`,
      );
      return;
    }

    let inappOk = 0;
    let emailOk = 0;

    // ─── In-app: cria Notification pra cada admin ─────────────────────
    if (wantInapp) {
      for (const alert of alerts) {
        for (const admin of admins) {
          try {
            await this.prisma.notification.create({
              data: {
                user_id: admin.id,
                tenant_id: tenantId,
                notification_type: 'trafego_alert',
                title: this.titleForAlert(alert),
                body: alert.message,
                data: {
                  alert_id: alert.id,
                  kind: alert.kind,
                  severity: alert.severity,
                  campaign_id: alert.campaign_id,
                  url: '/atendimento/marketing/trafego?tab=alertas',
                },
              },
            });
            inappOk++;
          } catch (e: any) {
            this.logger.warn(
              `[ALERT_NOTIFY] Falha criando Notification: ${e.message}`,
            );
          }
        }
      }
    }

    // ─── Email: agrupa todos os alertas num email so por admin ────────
    if (wantEmail && admins.length > 0) {
      try {
        const smtp = await this.settings.getSmtpConfig();
        if (!smtp.host) {
          this.logger.warn('[ALERT_NOTIFY] SMTP nao configurado — pulando email');
        } else {
          const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.port === 465,
            auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
          });

          const html = this.renderEmailHtml(alerts);
          const subject = `🚨 ${alerts.length} novo(s) alerta(s) de tráfego`;

          for (const admin of admins) {
            if (!admin.email) continue;
            try {
              await transporter.sendMail({
                from: smtp.from || smtp.user,
                to: admin.email,
                subject,
                html,
              });
              emailOk++;
            } catch (e: any) {
              this.logger.warn(
                `[ALERT_NOTIFY] Email pra ${admin.email} falhou: ${e.message}`,
              );
            }
          }
        }
      } catch (e: any) {
        this.logger.error(`[ALERT_NOTIFY] Erro no email: ${e.message}`);
      }
    }

    // ─── Marca alertas como notificados ───────────────────────────────
    await this.prisma.trafficAlert.updateMany({
      where: { id: { in: alerts.map((a) => a.id) } },
      data: { notified_at: new Date() },
    });

    this.logger.log(
      `[ALERT_NOTIFY] Tenant ${tenantId}: ${alerts.length} alertas → ${inappOk} in-app, ${emailOk} email`,
    );
  }

  // ─── Helpers de formatacao ───────────────────────────────────────────

  private titleForAlert(a: { kind: string; severity: string }): string {
    const emoji =
      a.severity === 'CRITICAL' ? '🚨' : a.severity === 'WARNING' ? '⚠️' : 'ℹ️';
    const labelMap: Record<string, string> = {
      HIGH_CPL: 'CPL acima da meta',
      LOW_CTR: 'CTR abaixo da meta',
      ZERO_CONVERSIONS: 'Sem conversões',
      OVERSPEND: 'Gasto acima do esperado',
      PAUSED_BUT_SPENDING: 'Campanha pausada com gasto',
      NO_DATA: 'Sem dados recentes',
    };
    return `${emoji} ${labelMap[a.kind] ?? a.kind}`;
  }

  private renderEmailHtml(
    alerts: Array<{
      kind: string;
      severity: string;
      message: string;
    }>,
  ): string {
    const items = alerts
      .map((a) => {
        const color =
          a.severity === 'CRITICAL'
            ? '#dc2626'
            : a.severity === 'WARNING'
              ? '#f59e0b'
              : '#0ea5e9';
        return `
          <li style="margin: 0 0 12px; padding: 12px; background: rgba(255,255,255,0.05); border-left: 3px solid ${color}; border-radius: 8px;">
            <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: ${color}; margin-bottom: 4px;">
              ${a.severity}
            </div>
            <div style="color: #e0e0e0;">${this.escapeHtml(a.message)}</div>
          </li>
        `;
      })
      .join('');

    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <div style="background: #1a1a2e; border-radius: 16px; padding: 24px; color: #e0e0e0;">
          <h2 style="margin: 0 0 8px; color: #fff; font-size: 18px;">
            📊 Alertas de Tráfego — André Lustosa Advogados
          </h2>
          <p style="margin: 0 0 20px; color: #a0a0b0; font-size: 13px;">
            ${alerts.length} novo(s) alerta(s) detectado(s) no monitoramento de Google Ads.
          </p>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${items}
          </ul>
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); text-align: center;">
            <a href="https://andrelustosaadvogados.com.br/atendimento/marketing/trafego"
               style="display: inline-block; background: #a1773d; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 13px;">
              Abrir painel de tráfego
            </a>
          </div>
        </div>
        <p style="text-align: center; color: #888; font-size: 11px; margin-top: 16px;">
          Enviado automaticamente pelo CRM. Para silenciar, ajuste em Configurações → Notificações.
        </p>
      </div>
    `;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
