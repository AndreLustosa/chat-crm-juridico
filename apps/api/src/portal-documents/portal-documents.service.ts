import { Injectable, NotFoundException, ForbiddenException, UnauthorizedException, BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException, Logger } from '@nestjs/common';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MediaS3Service } from '../media/s3.service';
import { NotificationsService } from '../notifications/notifications.service';
import { verifyShareToken, signShareToken } from '@crm/shared';

/**
 * MIME types que o cliente pode subir pelo portal.
 *
 * Filtramos pra evitar (1) executaveis e scripts (.exe, .sh, .js, .html), (2)
 * tipos exoticos que podem dar problema no antivirus do escritorio. PDF eh o
 * carro-chefe (RG, CPF, comprovantes de endereco scaneados); imagens cobrem
 * fotos do celular; office cobre fichas trabalhistas que clientes mandam
 * editaveis.
 *
 * HEIC entra porque iPhone gera por padrao — bloquear forcaria o cliente a
 * converter pra JPG, fricção desnecessaria.
 */
const ALLOWED_UPLOAD_MIMES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

/**
 * Limite de tamanho por upload. 25MB cobre PDFs scaneados de muitas paginas
 * e fotos de iPhone em alta resolucao, mas evita abuso (cliente subir video).
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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
    private notifications: NotificationsService,
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
        // @ts-ignore — campo novo, ainda nao tipado pelo prisma generate
        uploaded_via_portal: true,
        legal_case: {
          select: {
            id: true,
            case_number: true,
            action_type: true,
            legal_area: true,
          },
        },
        uploaded_by: { select: { name: true } },
      } as any,
      orderBy: { created_at: 'desc' },
    });

    return docs.map((d: any) => ({
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
      // true = doc subido por mim (cliente) via portal — UI marca diferente
      uploaded_via_portal: !!d.uploaded_via_portal,
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

  // ──────────────────────────────────────────────────────────────────────
  //  UPLOAD self-service pelo cliente
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Lista processos do cliente onde ele pode subir documento pelo portal.
   *
   * Criterio: legal_case ATIVO (in_tracking, nao arquivado, nao renunciado)
   * do lead_id em questao. Clientes nao podem subir doc em processo arquivado
   * ou que o escritorio renunciou — nao faz sentido.
   *
   * Retorna formato amigavel pro <select> do frontend.
   */
  async listUploadableCases(leadId: string) {
    const cases = await this.prisma.legalCase.findMany({
      where: {
        lead_id: leadId,
        in_tracking: true,
        archived: false,
        renounced: false,
      },
      select: {
        id: true,
        case_number: true,
        action_type: true,
        legal_area: true,
        opposing_party: true,
        client_is_author: true,
      },
      orderBy: { stage_changed_at: 'desc' },
    });

    return cases.map(c => ({
      id: c.id,
      case_number: c.case_number,
      action_type: c.action_type || c.legal_area || 'Processo',
      // Label amigavel pra o cliente: "Reclamatória contra Empresa X" ou
      // "Reclamatória de Empresa X contra você"
      label: this.buildCaseLabel(c),
    }));
  }

  private buildCaseLabel(c: {
    case_number: string | null;
    action_type: string | null;
    legal_area: string | null;
    opposing_party: string | null;
    client_is_author: boolean;
  }): string {
    const tipo = c.action_type || c.legal_area || 'Processo';
    const numero = c.case_number ? ` ${c.case_number}` : '';
    if (c.opposing_party) {
      const conector = c.client_is_author ? 'contra' : 'de';
      return `${tipo}${numero} — ${conector} ${c.opposing_party}`;
    }
    return `${tipo}${numero}`;
  }

  /**
   * Upload self-service: cliente sobe documento pelo portal direto pro
   * processo dele.
   *
   * Validacoes:
   *   1. caseId pertence ao leadId (anti-cross-tenant — cliente nao pode
   *      subir doc em processo de outro cliente)
   *   2. caso nao arquivado/renunciado/fora-de-tracking
   *   3. MIME na whitelist
   *   4. tamanho ate 25MB
   *   5. nome custom (se vier) sem trash
   *
   * Politica:
   *   - folder = CLIENTE forcado (cliente nao escolhe)
   *   - uploaded_by_id = advogado responsavel (FK exige User), mas
   *     uploaded_via_portal = true → UI do CRM mostra "Enviado pelo cliente"
   *   - notifica advogado responsavel via NotificationsService
   *     (NotificationsService.create enfileira WhatsApp com delay 5min e
   *     respeita dedup)
   */
  async upload(
    leadId: string,
    caseId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    opts?: { name?: string; description?: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Arquivo nao enviado');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `Arquivo muito grande. Limite: ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`,
      );
    }
    if (!ALLOWED_UPLOAD_MIMES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Tipo de arquivo nao permitido (${file.mimetype}). Aceitos: PDF, imagens, Word, Excel, TXT.`,
      );
    }

    // 1. Ownership: caso pertence ao lead?
    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        lead_id: true,
        tenant_id: true,
        case_number: true,
        action_type: true,
        legal_area: true,
        in_tracking: true,
        archived: true,
        renounced: true,
        lawyer_id: true,
      },
    });
    if (!legalCase || legalCase.lead_id !== leadId) {
      throw new NotFoundException('Processo nao encontrado');
    }
    if (legalCase.archived || legalCase.renounced || !legalCase.in_tracking) {
      throw new ForbiddenException('Processo nao aceita uploads no momento');
    }

    // 2. Resolve advogado responsavel — usado tanto pra uploaded_by_id
    // quanto pra notificacao. Prioridade: lawyer do caso → cs_user do lead
    // → fallback primeiro advogado do tenant.
    const lawyer = await this.resolveLawyerForUpload(legalCase.lawyer_id, leadId, legalCase.tenant_id);
    if (!lawyer) {
      throw new ForbiddenException('Sem advogado responsavel — contato o escritorio');
    }

    // 3. Sanitiza nome — aceita nome custom mas cai no original em caso de
    // string vazia ou so-espacos. Tamanho maximo 200 chars.
    const cleanName = (opts?.name || '').trim().slice(0, 200) || file.originalname;
    const cleanDesc = (opts?.description || '').trim().slice(0, 1000) || null;

    // 4. Upload S3
    const s3Key = this.buildS3Key(caseId, file.originalname);
    await this.s3.uploadBuffer(s3Key, file.buffer, file.mimetype);

    // 5. Cria CaseDocument
    const doc = await (this.prisma as any).caseDocument.create({
      data: {
        legal_case_id: caseId,
        uploaded_by_id: lawyer.id,
        tenant_id: legalCase.tenant_id || null,
        folder: 'CLIENTE',
        name: cleanName,
        original_name: file.originalname,
        s3_key: s3Key,
        mime_type: file.mimetype,
        size: file.size,
        description: cleanDesc,
        uploaded_via_portal: true,
      },
    });

    // 6. Busca nome do cliente pra notificacao
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, phone: true },
    });
    const clientName = lead?.name || lead?.phone || 'Cliente';
    const caseLabel = legalCase.case_number || legalCase.action_type || legalCase.legal_area || 'processo';

    // 7. Notifica advogado — NotificationsService enfileira WhatsApp com
    // delay 5min, respeita preferencias e dedup. read_at zera o WhatsApp se
    // advogado abrir o documento via app antes do timer.
    this.notifications.create({
      userId: lawyer.id,
      tenantId: legalCase.tenant_id || null,
      type: 'client_document_upload',
      title: `${clientName} enviou um documento`,
      body: `Processo ${caseLabel}: "${cleanName}"`,
      data: {
        documentId: doc.id,
        leadId,
        caseId,
        case_number: legalCase.case_number,
      },
    }).catch(() => {});

    this.logger.log(
      `[PORTAL/upload] Cliente ${leadId} subiu doc ${doc.id} no caso ${caseId} (${file.size} bytes, ${file.mimetype})`,
    );

    return {
      id: doc.id,
      name: doc.name,
      original_name: doc.original_name,
      mime_type: doc.mime_type,
      size: doc.size,
      created_at: doc.created_at.toISOString(),
    };
  }

  private buildS3Key(caseId: string, originalName: string): string {
    const ext = extname(originalName) || '';
    return `case-docs/${caseId}/${randomUUID()}${ext}`;
  }

  /**
   * Decide quem recebe a notificacao de upload do cliente.
   * Espelha resolveLawyerForLead do PortalSchedulingService.
   */
  private async resolveLawyerForUpload(
    caseLawyerId: string | null,
    leadId: string,
    tenantId: string | null,
  ): Promise<{ id: string; name: string | null } | null> {
    // 1. Advogado do legal_case
    if (caseLawyerId) {
      const direct = await this.prisma.user.findUnique({
        where: { id: caseLawyerId },
        select: { id: true, name: true },
      });
      if (direct) return direct;
    }

    // 2. cs_user do lead
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        cs_user: { select: { id: true, name: true } },
      },
    });
    if (lead?.cs_user) return lead.cs_user;

    // 3. Fallback: primeiro advogado do tenant
    return this.prisma.user.findFirst({
      where: {
        tenant_id: tenantId || undefined,
        roles: { hasSome: ['ADVOGADO', 'Advogados', 'ADMIN'] },
      },
      orderBy: { created_at: 'asc' },
      select: { id: true, name: true },
    });
  }
}
