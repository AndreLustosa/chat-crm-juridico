import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10); // yyyy-MM-dd
}

function subtractDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

@Injectable()
export class DjenService {
  private readonly logger = new Logger(DjenService.name);
  private readonly API_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Cron diário às 8h — sincroniza publicações de ontem e hoje */
  @Cron('0 8 * * *')
  async syncDaily() {
    const today = new Date();
    const yesterday = subtractDays(today, 1);
    this.logger.log('[DJEN] Iniciando sync diário...');
    await this.syncForDate(toDateStr(yesterday));
    await this.syncForDate(toDateStr(today));
    this.logger.log('[DJEN] Sync diário concluído.');
  }

  async syncForDate(date: string): Promise<{ date: string; saved: number; errors: number }> {
    const oabNumber = (await this.settings.get('DJEN_OAB_NUMBER')) || '14209';
    const oabUf     = (await this.settings.get('DJEN_OAB_UF'))     || 'AL';
    const lawyerName = (await this.settings.get('DJEN_LAWYER_NAME')) || 'André Freire Lustosa';

    const params = new URLSearchParams({
      numeroOab: oabNumber,
      ufOab: oabUf,
      nomeAdvogado: lawyerName,
      dataDisponibilizacaoInicio: date,
      dataDisponibilizacaoFim: date,
    });

    let items: any[] = [];
    try {
      const res = await fetch(`${this.API_BASE}?${params}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.logger.warn(`[DJEN] API retornou ${res.status} para ${date}`);
        return { date, saved: 0, errors: 1 };
      }
      const data: any = await res.json();
      // Suporte a múltiplos formatos de resposta da API PJe
      items = data?.items || data?.content || data?.data || (Array.isArray(data) ? data : []);
      this.logger.log(`[DJEN] ${items.length} publicações encontradas para ${date}`);
    } catch (e) {
      this.logger.error(`[DJEN] Erro ao consultar API para ${date}: ${e}`);
      return { date, saved: 0, errors: 1 };
    }

    let saved = 0;
    let errors = 0;
    for (const item of items) {
      try {
        const comunicacaoId = item.id ?? item.idComunicacao ?? item.comunicacaoId;
        if (!comunicacaoId) continue;

        const numeroProcesso: string =
          item.numeroProcessoFormatado ||
          item.numeroProcesso ||
          item.numero_processo ||
          '';

        // Tenta vincular ao LegalCase pelo número do processo
        let legalCaseId: string | null = null;
        if (numeroProcesso) {
          const lc = await this.prisma.legalCase.findFirst({
            where: { case_number: numeroProcesso, in_tracking: true },
            select: { id: true },
          });
          if (lc) legalCaseId = lc.id;
        }

        const dataDisp = item.dataDisponibilizacao
          ? new Date(item.dataDisponibilizacao)
          : new Date(date);

        await this.prisma.djenPublication.upsert({
          where: { comunicacao_id: Number(comunicacaoId) },
          update: { legal_case_id: legalCaseId },
          create: {
            comunicacao_id: Number(comunicacaoId),
            data_disponibilizacao: dataDisp,
            numero_processo: numeroProcesso,
            classe_processual: item.classeProcessual || item.classe || null,
            assunto: item.assunto || null,
            tipo_comunicacao: item.tipoComunicacao || item.tipo || null,
            conteudo: item.conteudo || item.texto || item.descricao || '',
            nome_advogado: item.nomeAdvogado || lawyerName,
            raw_json: item,
            legal_case_id: legalCaseId,
          },
        });
        saved++;
      } catch (e) {
        this.logger.error(`[DJEN] Erro ao salvar publicação: ${e}`);
        errors++;
      }
    }

    this.logger.log(`[DJEN] ${date}: ${saved} salvas, ${errors} erros`);
    return { date, saved, errors };
  }

  async findRecent(days = 7) {
    const since = subtractDays(new Date(), days);
    return this.prisma.djenPublication.findMany({
      where: { data_disponibilizacao: { gte: since } },
      include: {
        legal_case: {
          select: { id: true, case_number: true, legal_area: true, tracking_stage: true,
            lead: { select: { name: true } } },
        },
      },
      orderBy: { data_disponibilizacao: 'desc' },
      take: 100,
    });
  }

  async findByCase(legalCaseId: string) {
    return this.prisma.djenPublication.findMany({
      where: { legal_case_id: legalCaseId },
      orderBy: { data_disponibilizacao: 'desc' },
    });
  }
}
