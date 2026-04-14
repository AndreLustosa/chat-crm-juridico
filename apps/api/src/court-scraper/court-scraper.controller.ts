import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { CourtScraperService } from './court-scraper.service';

@Controller('court-scraper')
export class CourtScraperController {
  private readonly logger = new Logger(CourtScraperController.name);

  constructor(private readonly service: CourtScraperService) {}

  /** Busca um processo por número CNJ no ESAJ */
  @Get('search')
  async searchByNumber(@Query('caseNumber') caseNumber: string) {
    if (!caseNumber?.trim()) {
      throw new BadRequestException('Parâmetro caseNumber é obrigatório');
    }
    this.logger.log(`[GET /search] caseNumber=${caseNumber}`);
    return this.service.searchByNumber(caseNumber.trim());
  }

  /** Busca processos por OAB(s) no ESAJ — formato: "14209:AL,17697:AL" */
  @Get('search-oab')
  async searchByOAB(
    @Query('oabs') oabs: string,
    @Req() req: any,
  ) {
    if (!oabs?.trim()) {
      throw new BadRequestException('Parâmetro oabs é obrigatório (ex: 14209:AL,17697:AL)');
    }
    // Aceita formato "14209:AL,17697:AL" ou legado "14209,17697" (default UF=AL)
    const oabEntries = oabs.split(',').map(o => {
      const parts = o.trim().split(':');
      return { number: parts[0], uf: parts[1] || 'AL' };
    }).filter(e => e.number);
    const tenantId = req.user?.tenant_id;
    this.logger.log(`[GET /search-oab] oabs=${oabEntries.map(e => `${e.number}/${e.uf}`).join(',')}`);
    return this.service.searchByOABs(oabEntries, tenantId);
  }

  /** Lista advogados do escritório que têm OAB cadastrada */
  @Get('lawyers')
  async getLawyers(@Req() req: any) {
    const tenantId = req.user?.tenant_id;
    return this.service.getLawyersWithOAB(tenantId);
  }

  /** Importa processos em lote a partir dos dados do ESAJ */
  @Post('import')
  async importCases(
    @Body() body: {
      items: Array<{ processo_codigo: string; foro: string; lawyer_id?: string }>;
    },
    @Req() req: any,
  ) {
    if (!body.items?.length) {
      throw new BadRequestException('Informe pelo menos um processo para importar');
    }
    const tenantId = req.user?.tenant_id;
    const actorId = req.user?.id;
    this.logger.log(`[POST /import] Importando ${body.items.length} processos`);
    return this.service.importCases(body.items, tenantId, actorId);
  }
}
