import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TrafegoAssetGroupsService — leitura de Asset Groups (PMax/Demand Gen).
 *
 * Read-only — populamos via sync e a UI consome. Mutates de PMax (criar
 * asset group, adicionar asset, etc) ficam em sprint dedicado por
 * complexidade do payload.
 */
@Injectable()
export class TrafegoAssetGroupsService {
  private readonly logger = new Logger(TrafegoAssetGroupsService.name);

  constructor(private prisma: PrismaService) {}

  async listForCampaign(tenantId: string, campaignId: string) {
    const camp = await this.prisma.trafficCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, tenant_id: true, name: true },
    });
    if (!camp || camp.tenant_id !== tenantId) {
      throw new HttpException('Campanha não encontrada.', HttpStatus.NOT_FOUND);
    }
    const groups = await this.prisma.trafficAssetGroup.findMany({
      where: { campaign_id: campaignId, status: { not: 'REMOVED' } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: {
        group_assets: {
          select: {
            id: true,
            field_type: true,
            asset_type: true,
            asset_text: true,
            asset_url: true,
            performance_label: true,
            status: true,
          },
        },
      },
    });
    return groups;
  }

  async listAll(tenantId: string, opts: { limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
    return this.prisma.trafficAssetGroup.findMany({
      where: { tenant_id: tenantId, status: { not: 'REMOVED' } },
      orderBy: [{ status: 'asc' }, { last_seen_at: 'desc' }],
      take: limit,
      include: {
        campaign: { select: { id: true, name: true, channel_type: true } },
        _count: { select: { group_assets: true } },
      },
    });
  }
}
