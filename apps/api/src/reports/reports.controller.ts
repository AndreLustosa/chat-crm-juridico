import {
  Body, Controller, ForbiddenException, Post, Request, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

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
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buf.length.toString(),
    });
    res.send(buf);
  }
}

function buildFilename(prefix: string, from: string, to: string): string {
  const f = from.slice(0, 10);
  const t = to.slice(0, 10);
  return `${prefix}-${f}-a-${t}.pdf`;
}
