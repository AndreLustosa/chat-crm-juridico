import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Contratos do cliente (Clicksign). Mostra:
 *   - PENDENTE: cliente precisa assinar — link signing_url
 *   - ASSINADO: ja foi assinado — pode baixar PDF assinado (futuro)
 *   - CANCELADO/EXPIRADO: historico
 */
@Injectable()
export class PortalContractsService {
  private readonly logger = new Logger(PortalContractsService.name);

  constructor(private prisma: PrismaService) {}

  async list(leadId: string) {
    const contracts = await this.prisma.contractSignature.findMany({
      where: { lead_id: leadId },
      select: {
        id: true,
        cs_document_key: true,
        signing_url: true,
        status: true,
        signed_at: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return contracts.map(c => ({
      id: c.id,
      status: c.status,
      signing_url: c.status === 'PENDENTE' ? c.signing_url : null, // so retorna URL se ainda eh pra assinar
      signed_at: c.signed_at?.toISOString() || null,
      created_at: c.created_at.toISOString(),
      updated_at: c.updated_at.toISOString(),
    }));
  }
}
