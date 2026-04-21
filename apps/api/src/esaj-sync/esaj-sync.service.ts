import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EsajTjalScraper, inferTrackingStage } from '../court-scraper/scrapers/esaj-tjal.scraper';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SettingsService } from '../settings/settings.service';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const formatCNJ = (num: string): string => {
  const d = num.replace(/\D/g, '');
  if (d.length !== 20) return num;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
};

function movementHash(caseNumber: string, date: string, description: string): string {
  return crypto.createHash('sha256')
    .update(`${caseNumber}|${date}|${description.trim()}`)
    .digest('hex');
}

/** Verifica se está em horário comercial (Maceió UTC-3, seg-sex 8h-20h) */
function isBusinessHours(): boolean {
  const now = new Date();
  const offset = -3;
  const hour = (now.getUTCHours() + offset + 24) % 24;
  const day = new Date(now.getTime() + offset * 3600000).getDay();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 20;
}

@Injectable()
export class EsajSyncService {
  private readonly logger = new Logger(EsajSyncService.name);
  private readonly scraper = new EsajTjalScraper();
  private syncing = false;

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private settings: SettingsService,
  ) {}

  // ─── Cron Jobs ─────────────────────────────────────────────

  @Cron('0 8 * * 1-5')
  async syncMorning() {
    this.logger.log('[CRON] Sync matinal ESAJ iniciado');
    await this.syncAllTrackedCases();
  }

  @Cron('0 14 * * 1-5')
  async syncAfternoon() {
    this.logger.log('[CRON] Sync vespertino ESAJ iniciado');
    await this.syncAllTrackedCases();
  }

  // ─── Core Sync ─────────────────────────────────────────────

  async syncAllTrackedCases(): Promise<{
    total: number;
    synced: number;
    newMovements: number;
    notifications: number;
    errors: string[];
  }> {
    if (this.syncing) {
      this.logger.warn('[SYNC] Já há um sync em andamento, ignorando');
      return { total: 0, synced: 0, newMovements: 0, notifications: 0, errors: ['Sync já em andamento'] };
    }

    this.syncing = true;
    const startTime = Date.now();
    let totalSynced = 0;
    let totalNewMovements = 0;
    let totalNotifications = 0;
    const errors: string[] = [];

    try {
      // Buscar todos os processos em acompanhamento com número CNJ
      const cases = await this.prisma.legalCase.findMany({
        where: {
          in_tracking: true,
          archived: false,
          renounced: false,
          case_number: { not: null },
        },
        select: {
          id: true,
          case_number: true,
          tracking_stage: true,
          tenant_id: true,
          lead_id: true,
          lead: { select: { id: true, name: true, phone: true } },
          lawyer: { select: { id: true, name: true, phone: true } },
        },
      });

      this.logger.log(`[SYNC] Iniciando sync de ${cases.length} processos...`);

      // Inicializar sessão ESAJ uma única vez
      let cookie: string;
      try {
        cookie = await this.scraper.initSession();
      } catch (err: any) {
        this.logger.error(`[SYNC] Falha ao iniciar sessão ESAJ: ${err.message}`);
        return { total: cases.length, synced: 0, newMovements: 0, notifications: 0, errors: [`Sessão ESAJ falhou: ${err.message}`] };
      }

      for (const legalCase of cases) {
        try {
          await sleep(2000); // Rate limit ESAJ

          const digits = (legalCase.case_number || '').replace(/\D/g, '');
          if (digits.length !== 20) {
            this.logger.debug(`[SYNC] Pulando ${legalCase.case_number}: não é CNJ válido`);
            continue;
          }

          // Buscar detalhes do processo no ESAJ
          const data = await this.scraper.searchByNumber(digits);
          if (!data || !data.movements?.length) {
            totalSynced++;
            continue;
          }

          // Processar movimentações — detectar novas
          const newMovements: Array<{ date: string; description: string }> = [];

          for (const mov of data.movements) {
            const hash = movementHash(digits, mov.date, mov.description);

            try {
              await this.prisma.caseEvent.create({
                data: {
                  case_id: legalCase.id,
                  type: 'MOVIMENTACAO',
                  title: mov.description.slice(0, 200),
                  description: mov.description,
                  source: 'ESAJ',
                  event_date: this.parseDate(mov.date),
                  movement_hash: hash,
                  source_raw: { date: mov.date, description: mov.description },
                },
              });
              newMovements.push(mov);
            } catch (err: any) {
              // Unique constraint violation = já existe, pular
              if (err.code === 'P2002') continue;
              this.logger.warn(`[SYNC] Erro ao salvar movimento: ${err.message}`);
            }
          }

          totalSynced++;

          if (newMovements.length === 0) continue;
          totalNewMovements += newMovements.length;

          this.logger.log(
            `[SYNC] ${formatCNJ(digits)}: ${newMovements.length} nova(s) movimentação(ões)`,
          );

          // Atualizar tracking_stage se mudou
          const newStage = inferTrackingStage(data.movements);
          const oldStage = legalCase.tracking_stage;
          if (newStage !== oldStage) {
            await this.prisma.legalCase.update({
              where: { id: legalCase.id },
              data: {
                tracking_stage: newStage,
                stage_changed_at: new Date(),
              },
            });
            this.logger.log(`[SYNC] ${formatCNJ(digits)}: fase ${oldStage} → ${newStage}`);
          }

          // Enviar WhatsApp ao advogado
          if (isBusinessHours() && legalCase.lawyer?.phone) {
            try {
              await this.sendLawyerNotification(
                legalCase,
                newMovements,
                oldStage !== newStage ? { from: oldStage, to: newStage } : null,
              );
              totalNotifications++;

              // Marcar como notificado
              const hashes = newMovements.map(m => movementHash(digits, m.date, m.description));
              await this.prisma.caseEvent.updateMany({
                where: { movement_hash: { in: hashes } },
                data: { notified_at: new Date() },
              });
            } catch (err: any) {
              this.logger.warn(`[SYNC] Falha WhatsApp para ${legalCase.lawyer.name}: ${err.message}`);
            }
          }
        } catch (err: any) {
          const caseNum = legalCase.case_number || legalCase.id;
          errors.push(`${caseNum}: ${err.message}`);
          this.logger.warn(`[SYNC] Erro no processo ${caseNum}: ${err.message}`);
        }
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Re-consolidacao de LeadProfile REMOVIDA em 2026-04-21. Pivotamos
      // pra arquitetura on-demand: IA busca via tool call get_case_movements
      // quando cliente pergunta. Movimentacoes ja estao persistidas em
      // CaseEvent, ficam sempre acessiveis. Evita LLM desnecessario.

      // Salvar status do último sync
      try {
        await this.settings.set('ESAJ_LAST_SYNC', JSON.stringify({
          timestamp: new Date().toISOString(),
          total: cases.length,
          synced: totalSynced,
          newMovements: totalNewMovements,
          notifications: totalNotifications,
          errors: errors.length,
          elapsed_seconds: elapsed,
        }));
      } catch {}

      this.logger.log(
        `[SYNC] Concluído em ${elapsed}s: ${totalSynced}/${cases.length} processos, ` +
        `${totalNewMovements} movs novas, ${totalNotifications} notificacoes, ${errors.length} erros`,
      );

      return {
        total: cases.length,
        synced: totalSynced,
        newMovements: totalNewMovements,
        notifications: totalNotifications,
        errors,
      };
    } finally {
      this.syncing = false;
    }
  }

  // ─── WhatsApp Notification ─────────────────────────────────

  private async sendLawyerNotification(
    legalCase: {
      case_number: string | null;
      lead: { name: string | null; phone: string | null } | null;
      lawyer: { name: string | null; phone: string | null } | null;
    },
    newMovements: Array<{ date: string; description: string }>,
    stageChange: { from: string | null; to: string } | null,
  ) {
    const lawyerPhone = legalCase.lawyer?.phone;
    if (!lawyerPhone) return;

    const caseNumber = formatCNJ((legalCase.case_number || '').replace(/\D/g, ''));
    const clientName = legalCase.lead?.name || 'Cliente';
    const count = newMovements.length;

    const movLines = newMovements
      .slice(0, 8) // Máximo 8 movimentações no WhatsApp
      .map(m => `📅 ${m.date} — ${m.description.slice(0, 120)}`)
      .join('\n');

    const stageText = stageChange
      ? `\n⚡ *Fase atualizada:* ${stageChange.from || 'N/A'} → ${stageChange.to}\n`
      : '';

    const moreText = count > 8 ? `\n_... e mais ${count - 8} movimentação(ões)_` : '';

    const message =
      `📋 *${count} nova(s) movimentação(ões) — ESAJ*\n\n` +
      `*Processo:* ${caseNumber}\n` +
      `*Cliente:* ${clientName}\n\n` +
      movLines +
      moreText +
      stageText +
      `\n_Acesse o CRM para acompanhar ou criar tarefas._`;

    // Buscar instância WhatsApp
    const instance = process.env.EVOLUTION_INSTANCE_NAME || 'whatsapp';

    await this.whatsapp.sendText(lawyerPhone, message, instance);
    this.logger.log(`[NOTIFY] WhatsApp enviado para ${legalCase.lawyer?.name} (${lawyerPhone})`);
  }

  // ─── Helpers ───────────────────────────────────────────────

  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    // Formato ESAJ: "01/04/2026" ou "01/04/2026 10:30"
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    return new Date(`${match[3]}-${match[2]}-${match[1]}T12:00:00Z`);
  }

  // ─── Status ────────────────────────────────────────────────

  async getLastSyncStatus(): Promise<any> {
    const raw = await this.settings.get('ESAJ_LAST_SYNC');
    if (!raw) return { status: 'never', message: 'Nenhum sync realizado' };
    try {
      return { status: 'ok', ...JSON.parse(raw) };
    } catch {
      return { status: 'unknown', raw };
    }
  }
}
