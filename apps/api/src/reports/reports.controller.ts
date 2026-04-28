import {
  Body, Controller, ForbiddenException, Get, Post, Query, Request, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  /**
   * GET /reports/history
   * Lista histórico do tenant. ASSOCIADO/ADVOGADO veem apenas próprios.
   */
  @Get('history')
  async history(
    @Query('limit') limit: string,
    @Request() req: any,
  ) {
    const roles: string[] = req.user?.roles || [];
    const isAdmin = roles.includes('ADMIN') || roles.includes('FINANCEIRO');
    return this.service.listHistory({
      tenantId: req.user.tenant_id,
      userId: isAdmin ? undefined : req.user.id,
      limit: limit ? Math.min(200, parseInt(limit, 10)) : 50,
    });
  }

  /**
   * POST /reports/dashboard-snapshot
   *
   * Body: {
   *   from, to: ISO dates
   *   lawyerId?: string
   *   compare?: 'previous-month' | 'previous-year'
   *   includeCharts?: boolean
   *   includeDetailTable?: boolean
   *   observations?: string
   *   orientation?: 'portrait' | 'landscape'
   * }
   *
   * Retorna PDF binario (application/pdf). Frontend salva via window.open
   * com URL.createObjectURL.
   *
   * Permissoes: ADMIN/FINANCEIRO/ADVOGADO. ESTAGIARIO/OPERADOR bloqueados.
   * ADVOGADO so vê snapshot do proprio (lawyerId forçado pra req.user.id).
   */
  @Post('dashboard-snapshot')
  async dashboardSnapshot(
    @Body() body: {
      from: string;
      to: string;
      lawyerId?: string;
      compare?: 'previous-month' | 'previous-year';
      includeCharts?: boolean;
      includeDetailTable?: boolean;
      observations?: string;
      orientation?: 'portrait' | 'landscape';
    },
    @Request() req: any,
    @Res() res: Response,
  ) {
    const roles: string[] = req.user?.roles || [];
    const isAdmin = roles.includes('ADMIN') || roles.includes('FINANCEIRO');
    const canExport = isAdmin || roles.includes('ADVOGADO');
    if (!canExport) {
      throw new ForbiddenException('Sem permissao para gerar este relatorio');
    }

    // ADVOGADO so ve dele
    const effectiveLawyerId = isAdmin ? body.lawyerId : req.user.id;

    // Resolve nome do advogado (subtitulo do PDF)
    let lawyerName: string | undefined;
    if (effectiveLawyerId) {
      // Service nao tem helper, query direto via prisma (compartilhado)
      const u = await this.service['prisma'].user.findUnique({
        where: { id: effectiveLawyerId },
        select: { name: true },
      });
      lawyerName = u?.name;
    }

    const buf = await this.service.generateDashboardSnapshot({
      tenantId: req.user.tenant_id,
      actorId: req.user.id,
      actorName: req.user.email || 'Usuário',
      from: body.from,
      to: body.to,
      lawyerId: effectiveLawyerId,
      lawyerName,
      compare: body.compare,
      includeCharts: body.includeCharts,
      includeDetailTable: body.includeDetailTable,
      observations: body.observations,
      orientation: body.orientation,
    });

    const filename = buildFilename('dashboard-snapshot', body.from, body.to);
    // Registra no historico (fire-and-forget)
    this.service.recordHistory({
      tenantId: req.user.tenant_id,
      userId: req.user.id,
      kind: 'dashboard-snapshot',
      displayName: `Dashboard — ${formatPeriodLabel(body.from, body.to)}`,
      payload: body,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buf.length.toString(),
    });
    res.send(buf);
  }

  /**
   * POST /reports/transactions-statement
   * Extrato de receitas OU despesas (definido por body.type).
   */
  @Post('transactions-statement')
  async transactionsStatement(
    @Body() body: {
      type: 'RECEITA' | 'DESPESA';
      from: string;
      to: string;
      lawyerId?: string;
      observations?: string;
      summaryOnly?: boolean;
      orientation?: 'portrait' | 'landscape';
    },
    @Request() req: any,
    @Res() res: Response,
  ) {
    const roles: string[] = req.user?.roles || [];
    const isAdmin = roles.includes('ADMIN') || roles.includes('FINANCEIRO');
    const canExport = isAdmin || roles.includes('ADVOGADO');
    if (!canExport) throw new ForbiddenException('Sem permissao para gerar este relatorio');

    const effectiveLawyerId = isAdmin ? body.lawyerId : req.user.id;
    let lawyerName: string | undefined;
    if (effectiveLawyerId) {
      const u = await this.service['prisma'].user.findUnique({
        where: { id: effectiveLawyerId },
        select: { name: true },
      });
      lawyerName = u?.name;
    }

    const buf = await this.service.generateTransactionsStatement({
      tenantId: req.user.tenant_id,
      actorName: req.user.email || 'Usuário',
      type: body.type,
      from: body.from,
      to: body.to,
      lawyerId: effectiveLawyerId,
      lawyerName,
      observations: body.observations,
      summaryOnly: body.summaryOnly,
      orientation: body.orientation,
    });

    const prefix = body.type === 'RECEITA' ? 'extrato-receitas' : 'extrato-despesas';
    const filename = buildFilename(prefix, body.from, body.to);
    this.service.recordHistory({
      tenantId: req.user.tenant_id,
      userId: req.user.id,
      kind: body.type === 'RECEITA' ? 'extrato-receitas' : 'extrato-despesas',
      displayName: `${body.type === 'RECEITA' ? 'Extrato de receitas' : 'Extrato de despesas'} — ${formatPeriodLabel(body.from, body.to)}`,
      payload: body,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buf.length.toString(),
    });
    res.send(buf);
  }

  /**
   * POST /reports/charges-list
   * Lista de cobranças com status Asaas.
   */
  @Post('charges-list')
  async chargesList(
    @Body() body: {
      filter: 'all' | 'overdue' | 'pending' | 'paid' | 'awaiting_alvara' | 'no_cpf' | 'to_send' | 'due_today';
      lawyerId?: string;
      observations?: string;
    },
    @Request() req: any,
    @Res() res: Response,
  ) {
    const roles: string[] = req.user?.roles || [];
    const isAdmin = roles.includes('ADMIN') || roles.includes('FINANCEIRO');
    const canExport = isAdmin || roles.includes('ADVOGADO');
    if (!canExport) throw new ForbiddenException('Sem permissao para gerar este relatorio');

    const effectiveLawyerId = isAdmin ? body.lawyerId : req.user.id;
    let lawyerName: string | undefined;
    if (effectiveLawyerId) {
      const u = await this.service['prisma'].user.findUnique({
        where: { id: effectiveLawyerId },
        select: { name: true },
      });
      lawyerName = u?.name;
    }

    const buf = await this.service.generateChargesList({
      tenantId: req.user.tenant_id,
      actorName: req.user.email || 'Usuário',
      filter: body.filter || 'all',
      lawyerId: effectiveLawyerId,
      lawyerName,
      observations: body.observations,
    });

    const today = new Date().toISOString().slice(0, 10);
    const filename = `cobrancas-${body.filter}-${today}.pdf`;
    this.service.recordHistory({
      tenantId: req.user.tenant_id,
      userId: req.user.id,
      kind: 'charges-list',
      displayName: `Cobranças (${body.filter}) — ${today}`,
      payload: body,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buf.length.toString(),
    });
    res.send(buf);
  }
}

function formatPeriodLabel(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  if (f.getUTCMonth() === t.getUTCMonth() && f.getUTCFullYear() === t.getUTCFullYear()) {
    return `${months[f.getUTCMonth()]}/${f.getUTCFullYear()}`;
  }
  return `${from.slice(0, 10)} a ${to.slice(0, 10)}`;
}

function buildFilename(prefix: string, from: string, to: string): string {
  const f = from.slice(0, 10);
  const t = to.slice(0, 10);
  return `${prefix}-${f}-a-${t}.pdf`;
}
