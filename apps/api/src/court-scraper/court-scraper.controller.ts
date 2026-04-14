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

  /** Busca processos por OAB(s) no ESAJ */
  @Get('search-oab')
  async searchByOAB(
    @Query('oabs') oabs: string,
    @Query('page') page: string | undefined,
    @Req() req: any,
  ) {
    if (!oabs?.trim()) {
      throw new BadRequestException('Parâmetro oabs é obrigatório (ex: 14209,17697)');
    }
    const oabList = oabs.split(',').map(o => o.trim()).filter(Boolean);
    const tenantId = req.user?.tenant_id;
    this.logger.log(`[GET /search-oab] oabs=${oabList.join(',')} page=${page || 1}`);
    return this.service.searchByOABs(oabList, parseInt(page || '1'), tenantId);
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
