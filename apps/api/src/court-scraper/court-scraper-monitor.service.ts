import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CourtScraperService } from './court-scraper.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { LockService } from '../common/locks/lock.service';

/**
 * Monitor ESAJ por OAB — cron diario que detecta processos NOVOS no
 * tribunal vinculados as OABs cadastradas no sistema e notifica o
 * advogado pra revisar/importar.
 *
 * Motivacao: advogado nao precisa entrar na busca OAB manualmente
 * pra descobrir que tem novos processos distribuidos. O sistema
 * detecta sozinho e notifica.
 *
 * Como funciona:
 *   1. Busca todos os Users com `oab_number` preenchido (qualquer tenant)
 *   2. Pra cada um, roda `searchByOABs` no ESAJ
 *   3. Filtra os que `already_registered=false` (processos nao cadastrados)
 *   4. Cria 1 Notification consolidada por advogado com a lista
 *   5. Emite socket event `new_cases_from_esaj` pro frontend mostrar badge
 *
 * Cron: 7h BRT seg-sex (antes do expediente). Fora de horario: nao roda
 * (evita consumo desnecessario do scraper e spam de notificacao).
 */
@Injectable()
export class CourtScraperMonitorService {
  private readonly logger = new Logger(CourtScraperMonitorService.name);

  constructor(
    private prisma: PrismaService,
    private scraper: CourtScraperService,
    private chatGateway: ChatGateway,
    private lock: LockService,
  ) {}

  // Roda TODOS os dias 07h BRT (politica unificada 2026-04-26 — antes era seg-sex).
  // Tribunal nao distribui processos novos fim de semana mas o scraper retorna
  // rapido; e em segunda-feira a varredura pega tudo que entrou no fim de semana.
  @Cron('0 7 * * *', { timeZone: 'America/Maceio' })
  async checkNewCasesForAllOabs() {
    // Lock distribuido pra impedir double-run em multi-replica.
    // TTL 30min: pra cada advogado com OAB faz scraping, pode demorar.
    // Migrado 2026-04-26.
    const result = await this.lock.withLock('monitor-oab', 30 * 60, async () => {
      return this._checkNewCasesForAllOabs();
    });
    if (result === null) {
      this.logger.warn('[MONITOR-OAB] Skipado — outra réplica ja está rodando');
    }
  }

  private async _checkNewCasesForAllOabs() {
    this.logger.log('[MONITOR-OAB] Iniciando varredura diaria de processos novos no ESAJ');

    // 1. Advogados com OAB preenchida
    const lawyers = await this.prisma.user.findMany({
      where: {
        oab_number: { not: null },
        roles: { hasSome: ['ADVOGADO', 'Advogados', 'ADMIN'] },
      },
      select: { id: true, name: true, oab_number: true, oab_uf: true, tenant_id: true },
    });

    if (lawyers.length === 0) {
      this.logger.log('[MONITOR-OAB] Nenhum advogado com OAB cadastrada — nada a verificar');
      return;
    }

    this.logger.log(`[MONITOR-OAB] Verificando ${lawyers.length} advogado(s)`);

    let totalNovos = 0;
    let totalNotificacoes = 0;

    for (const lawyer of lawyers) {
      if (!lawyer.oab_number) continue;

      try {
        // 2. Busca no ESAJ — ja retorna `already_registered` marcado
        const result = await this.scraper.searchByOABs(
          [{ number: lawyer.oab_number, uf: lawyer.oab_uf || 'AL' }],
          lawyer.tenant_id ?? undefined,
        );

        // 3. Filtra apenas os nao-cadastrados
        const novos = (result.cases || []).filter((c: any) => !c.already_registered);

        if (novos.length === 0) {
          this.logger.log(
            `[MONITOR-OAB] ${lawyer.name} (OAB ${lawyer.oab_number}/${lawyer.oab_uf}): 0 novos`,
          );
          continue;
        }

        totalNovos += novos.length;

        this.logger.log(
          `[MONITOR-OAB] ${lawyer.name} (OAB ${lawyer.oab_number}/${lawyer.oab_uf}): ${novos.length} processo(s) novo(s) detectado(s)`,
        );

        // 4. Cria UMA Notification consolidada com lista dos novos
        const firstThree = novos.slice(0, 3).map((c: any) => c.case_number).join(', ');
        const extra = novos.length > 3 ? ` e mais ${novos.length - 3}` : '';

        try {
          await this.prisma.notification.create({
            data: {
              user_id: lawyer.id,
              tenant_id: lawyer.tenant_id,
              notification_type: 'new_cases_from_esaj',
              title: `${novos.length} novo${novos.length !== 1 ? 's' : ''} processo${novos.length !== 1 ? 's' : ''} no ESAJ`,
              body: `OAB ${lawyer.oab_number}/${lawyer.oab_uf || 'AL'}: ${firstThree}${extra}`,
              data: {
                oab: lawyer.oab_number,
                uf: lawyer.oab_uf || 'AL',
                count: novos.length,
                case_numbers: novos.map((c: any) => c.case_number),
                processo_codigos: novos.map((c: any) => c.processo_codigo),
              },
            },
          });
          totalNotificacoes++;
        } catch (e: any) {
          this.logger.warn(`[MONITOR-OAB] Falha ao criar Notification pro ${lawyer.id}: ${e.message}`);
        }

        // 5. Socket event pro frontend — badge/toast imediato se online
        try {
          this.chatGateway.emitLegalCaseUpdate(lawyer.id, {
            caseId: 'batch-esaj-monitor',
            action: 'new_cases_from_esaj',
            count: novos.length,
            oab: lawyer.oab_number,
            uf: lawyer.oab_uf || 'AL',
          });
        } catch {
          // socket desconectado — ok, a Notification persiste no banco
        }

        // Delay curto entre advogados pra nao sobrecarregar o ESAJ
        await new Promise(r => setTimeout(r, 2000));
      } catch (e: any) {
        this.logger.error(
          `[MONITOR-OAB] Erro ao verificar OAB ${lawyer.oab_number} (${lawyer.name}): ${e.message}`,
        );
      }
    }

    this.logger.log(
      `[MONITOR-OAB] Concluido: ${totalNovos} processo(s) novo(s) encontrado(s), ${totalNotificacoes} advogado(s) notificado(s)`,
    );
  }
}
