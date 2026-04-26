import { Injectable, NotFoundException, ForbiddenException, UnauthorizedException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
import { verifyShareToken, signShareToken } from '@crm/shared';

/**
 * Documentos visiveis ao cliente no portal.
 *
 * Politica de visibilidade:
 *   - PUBLICO (cliente ve): CLIENTE, CONTRATOS, DECISOES, PROCURACOES
 *   - INTERNO (so escritorio): PROVAS, PETICOES, OUTROS
 *
 * Razao: documentos como peticoes em rascunho, provas em analise interna, ou
 * notas do escritorio nao devem aparecer pro cliente. Decisoes, contratos e
 * procuracoes sim — sao "produtos" do trabalho juridico que o cliente tem
 * direito de acessar.
 */
const PUBLIC_FOLDERS = ['CLIENTE', 'CONTRATOS', 'DECISOES', 'PROCURACOES'] as const;

@Injectable()
export class PortalDocumentsService {
  private readonly logger = new Logger(PortalDocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private s3: MediaS3Service,
  ) {}

  /**
   * Lista documentos visiveis ao cliente. Filtra por:
   *   - LegalCase.lead_id = cliente.id (ownership)
   *   - folder IN PUBLIC_FOLDERS
   *   - LegalCase nao arquivado/renunciado
   */
  async list(leadId: string) {
    const docs = await this.prisma.caseDocument.findMany({
      where: {
        folder: { in: PUBLIC_FOLDERS as unknown as string[] },
        legal_case: {
          lead_id: leadId,
          archived: false,
          renounced: false,
        },
      },
      select: {
        id: true,
        name: true,
        original_name: true,
        folder: true,
        mime_type: true,
        size: true,
        description: true,
        version: true,
        created_at: true,
        legal_case: {
          select: {
            id: true,
            case_number: true,
            action_type: true,
            legal_area: true,
          },
        },
        uploaded_by: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return docs.map(d => ({
      id: d.id,
      name: d.name,
      original_name: d.original_name,
      folder: d.folder,
      mime_type: d.mime_type,
      size: d.size,
      description: d.description,
      version: d.version,
      created_at: d.created_at.toISOString(),
      uploaded_by: d.uploaded_by?.name || null,
      case: {
        id: d.legal_case.id,
        case_number: d.legal_case.case_number,
        action_type: d.legal_case.action_type || d.legal_case.legal_area || 'Processo',
      },
    }));
  }

  /**
   * Stream do arquivo. Verifica ownership + folder publico antes de servir.
   */
  async download(leadId: string, docId: string) {
    const doc = await this.prisma.caseDocument.findUnique({
      where: { id: docId },
      include: {
        legal_case: { select: { lead_id: true, archived: true, renounced: true } },
      },
    });
    if (!doc) throw new NotFoundException('Documento nao encontrado');
    if (doc.legal_case.lead_id !== leadId) {
      // Anti-enumeration: 404 em vez de 403 — cliente nem sabe se existe
      throw new NotFoundException('Documento nao encontrado');
    }
    if (doc.legal_case.archived || doc.legal_case.renounced) {
      throw new NotFoundException('Documento nao disponivel');
    }
    if (!PUBLIC_FOLDERS.includes(doc.folder as any)) {
      // Folder interno — cliente nao deveria nem listar, mas guard duplo
      throw new ForbiddenException('Documento nao disponivel pra cliente');
    }

    this.logger.log(`[PORTAL/doc] Cliente ${leadId} baixou doc ${docId} (${doc.original_name})`);
    const result = await this.s3.getObjectStream(doc.s3_key);
    return {
      ...result,
      fileName: doc.original_name,
      mimeType: doc.mime_type,
    };
  }

  /**
   * Gera URL publica temporaria pra cliente baixar documento sem login.
   * Usado pela Sophia (IA) quando manda documento via WhatsApp — Evolution
   * API precisa de URL publica acessivel.
   *
   * Token assinado com JWT_SECRET, TTL 7 dias (cliente pode demorar pra abrir).
   */
  buildPublicShareUrl(docId: string, leadId: string): string {
    const secret = process.env.JWT_SECRET || '__INSECURE_DEV_FALLBACK_CHANGE_ME__';
    const apiBase = process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL || '';
    const token = signShareToken(
      { sub: docId, lead_id: leadId, aud: 'doc-share' },
      secret,
      7 * 24 * 60 * 60, // 7 dias
    );
    return `${apiBase}/portal/documents/share/${docId}?token=${encodeURIComponent(token)}`;
  }

  /**
   * Stream publico via token compartilhavel — sem cookie, sem auth normal.
   * Valida assinatura HMAC + ownership (lead_id no token bate com doc).
   *
   * Bloqueios:
   *   - Token invalido / expirado / mal formado → 401
   *   - Doc nao existe → 404
   *   - Doc nao eh do lead do token → 401 (anti-token-shuffling)
   *   - Folder interno → 403 (defesa em profundidade)
   *   - Caso arquivado → 404
   */
  async downloadByShareToken(docId: string, token: string) {
    const secret = process.env.JWT_SECRET || '__INSECURE_DEV_FALLBACK_CHANGE_ME__';
    const payload = verifyShareToken(token, secret);
    if (!payload || payload.aud !== 'doc-share' || payload.sub !== docId) {
      throw new UnauthorizedException('Link expirado ou inválido');
    }

    const doc = await this.prisma.caseDocument.findUnique({
      where: { id: docId },
      include: {
        legal_case: { select: { lead_id: true, archived: true, renounced: true } },
      },
    });
    if (!doc) throw new NotFoundException('Documento nao encontrado');
    if (doc.legal_case.lead_id !== payload.lead_id) {
      // Token foi gerado pra OUTRO lead — bloqueia
      throw new UnauthorizedException('Link expirado ou inválido');
    }
    if (doc.legal_case.archived || doc.legal_case.renounced) {
      throw new NotFoundException('Documento nao disponivel');
    }
    if (!PUBLIC_FOLDERS.includes(doc.folder as any)) {
      throw new ForbiddenException('Documento nao disponivel pra cliente');
    }

    this.logger.log(`[PORTAL/doc-share] Doc ${docId} baixado via token (lead ${payload.lead_id})`);
    const result = await this.s3.getObjectStream(doc.s3_key);
    return {
      ...result,
      fileName: doc.original_name,
      mimeType: doc.mime_type,
    };
  }
}
