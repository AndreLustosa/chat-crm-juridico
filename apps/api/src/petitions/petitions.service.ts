import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { tenantOrDefault } from '../common/constants/tenant';

const VALID_TYPES = [
  'INICIAL', 'CONTESTACAO', 'REPLICA', 'EMBARGOS',
  'RECURSO', 'MANIFESTACAO', 'OUTRO',
] as const;

const VALID_STATUSES = [
  'RASCUNHO', 'EM_REVISAO', 'APROVADA', 'PROTOCOLADA',
] as const;

/**
 * Bug fix 2026-05-10 (Peticoes PR3 #38): documentar workflow.
 *
 * Maquina de estados:
 *   RASCUNHO → EM_REVISAO            (estagiario submete pra revisao)
 *   EM_REVISAO → RASCUNHO            (advogado devolve via /review action=DEVOLVER)
 *   EM_REVISAO → APROVADA            (advogado aprova via /review action=APROVAR)
 *   APROVADA → EM_REVISAO            (correção pos-aprovacao — caso raro)
 *   APROVADA → PROTOCOLADA           (peca enviada ao tribunal — terminal)
 *   PROTOCOLADA → (nada)             (terminal — peca ja no fisico)
 *
 * Bloqueios:
 *   - update() rejeita mudanca de content em APROVADA/PROTOCOLADA (PR1 #7)
 *   - delete() so permite RASCUNHO (line ~570)
 */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  RASCUNHO: ['EM_REVISAO'],
  EM_REVISAO: ['RASCUNHO', 'APROVADA'],
  APROVADA: ['EM_REVISAO', 'PROTOCOLADA'],
  PROTOCOLADA: [],
};

@Injectable()
export class PetitionsService {
  private readonly logger = new Logger(PetitionsService.name);

  constructor(
    private prisma: PrismaService,
    private googleDrive: GoogleDriveService,
    private gateway: ChatGateway,
  ) {}

  // ─── Helpers ────────────────────────────────────────────

  // Bug fix 2026-05-10 (Peticoes PR3 #28): cache de templates 5min.
  // Templates raramente mudam (admin edita 1x/mes); pico de criacao
  // gera dezenas de findUnique iguais. Cache LRU simples.
  private templateCache = new Map<string, { template: any; expiresAt: number }>();
  private readonly TEMPLATES_CACHE_TTL_MS = 5 * 60_000;

  private async getCachedTemplate(templateId: string): Promise<any | null> {
    const cached = this.templateCache.get(templateId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.template;
    }
    if (cached) this.templateCache.delete(templateId);

    const template = await this.prisma.legalTemplate.findUnique({
      where: { id: templateId },
    });

    if (template) {
      this.templateCache.set(templateId, {
        template,
        expiresAt: Date.now() + this.TEMPLATES_CACHE_TTL_MS,
      });
      // LRU cap simples
      if (this.templateCache.size > 500) {
        for (const k of this.templateCache.keys()) {
          this.templateCache.delete(k);
          if (this.templateCache.size <= 400) break;
        }
      }
    }
    return template;
  }

  /** Invalidator pra LegalTemplate.update e .remove */
  invalidateTemplateCache(templateId?: string): void {
    if (templateId) this.templateCache.delete(templateId);
    else this.templateCache.clear();
  }

  private async verifyCaseAccess(caseId: string, tenantId?: string) {
    const lc = await this.prisma.legalCase.findUnique({
      where: { id: caseId },
      select: { id: true, tenant_id: true },
    });
    if (!lc) throw new NotFoundException('Caso não encontrado');
    if (tenantId && lc.tenant_id && lc.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    return lc;
  }

  private async verifyPetitionAccess(petitionId: string, tenantId?: string) {
    const petition = await this.prisma.casePetition.findUnique({
      where: { id: petitionId },
      include: { legal_case: { select: { tenant_id: true } } },
    });
    if (!petition) throw new NotFoundException('Petição não encontrada');
    if (tenantId && petition.legal_case.tenant_id && petition.legal_case.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }
    return petition;
  }

  // ─── CRUD ──────────────────────────────────────────────

  async findByCaseId(caseId: string, tenantId?: string) {
    await this.verifyCaseAccess(caseId, tenantId);

    return this.prisma.casePetition.findMany({
      where: { legal_case_id: caseId },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        template_id: true,
        google_doc_id: true,
        google_doc_url: true,
        deadline_at: true,
        review_notes: true,
        created_at: true,
        updated_at: true,
        created_by: { select: { id: true, name: true } },
        reviewed_by: { select: { id: true, name: true } },
        _count: { select: { versions: true } },
      },
      orderBy: { updated_at: 'desc' },
    });
  }

  async create(
    caseId: string,
    data: {
      title: string;
      type: string;
      template_id?: string;
      content_json?: any;
      content_html?: string;
      create_google_doc?: boolean;
      deadline_at?: string;
    },
    userId: string,
    tenantId?: string,
  ) {
    await this.verifyCaseAccess(caseId, tenantId);

    const type = VALID_TYPES.includes(data.type as any) ? data.type : 'OUTRO';

    let contentJson = data.content_json || null;
    let contentHtml = data.content_html || null;

    // Bug fix 2026-05-10 (Peticoes PR3 #28):
    // Cache 5min do template content. Antes findUnique por template_id
    // em CADA criacao de peticao — pico de criacao gerava 100 SELECTs
    // identicos. Templates raramente mudam (admin edita 1x/mes).
    if (data.template_id) {
      const template = await this.getCachedTemplate(data.template_id);
      if (template) {
        contentJson = template.content_json;
        // Incremento de usage_count ainda eh hit no DB (correto — eh
        // dado mutavel, nao cacheavel)
        await this.prisma.legalTemplate.update({
          where: { id: data.template_id },
          data: { usage_count: { increment: 1 } },
        });
      }
    }

    // Google Drive: criar Doc se configurado e solicitado
    let googleDocId: string | null = null;
    let googleDocUrl: string | null = null;

    if (data.create_google_doc !== false) {
      try {
        const configured = await this.googleDrive.isConfigured();
        if (configured) {
          // Bug fix 2026-05-10 (Peticoes PR3 #34):
          // logs de criacao do Drive eram log.log (info) — em alta
          // volumetria poluiam stdout. Movidos pra debug. Resumo final
          // continua em log.log pra audit operacional.
          this.logger.debug(`[GDRIVE] Criando Doc pra peticao "${data.title}" no caso ${caseId}`);
          const legalCase = await this.prisma.legalCase.findUnique({
            where: { id: caseId },
            select: { lead_id: true, legal_area: true, case_number: true },
          });
          if (legalCase) {
            const caseLabel = [legalCase.legal_area, legalCase.case_number || 'Novo Caso']
              .filter(Boolean)
              .join(' - ');

            this.logger.debug(`[GDRIVE] Criando pasta do caso: ${caseLabel}`);
            const folderId = await this.googleDrive.ensureCaseFolder(
              caseId,
              legalCase.lead_id,
              caseLabel,
            );
            this.logger.debug(`[GDRIVE] Pasta do caso OK: ${folderId}. Criando Google Doc...`);

            const doc = await this.googleDrive.createDoc(
              data.title,
              folderId,
              contentHtml || undefined,
            );
            googleDocId = doc.docId;
            googleDocUrl = doc.docUrl;
            this.logger.log(`[GDRIVE] Doc criado: ${googleDocId} (${data.title})`);
          } else {
            this.logger.warn(`Caso ${caseId} não encontrado para criar Google Doc`);
          }
        }
      } catch (err: any) {
        // Log detalhado do erro para diagnóstico
        const errDetails = err?.response?.data || err?.message || err;
        this.logger.error(`ERRO ao criar Google Doc: ${JSON.stringify(errDetails)}`, err.stack);
        // Não re-throw — a petição será criada sem Google Doc (editor local como fallback)
      }
    }

    const petition = await this.prisma.casePetition.create({
      data: {
        legal_case_id: caseId,
        created_by_id: userId,
        tenant_id: tenantOrDefault(tenantId),
        title: data.title,
        type,
        content_json: contentJson,
        content_html: contentHtml,
        template_id: data.template_id || null,
        deadline_at: data.deadline_at ? new Date(data.deadline_at) : null,
        google_doc_id: googleDocId,
        google_doc_url: googleDocUrl,
      },
      include: {
        created_by: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Petição criada: ${petition.id} (${type}) no caso ${caseId}`);
    return petition;
  }

  async findById(petitionId: string, tenantId?: string) {
    const petition = await this.prisma.casePetition.findUnique({
      where: { id: petitionId },
      include: {
        created_by: { select: { id: true, name: true } },
        reviewed_by: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
        _count: { select: { versions: true } },
      },
    });
    if (!petition) throw new NotFoundException('Petição não encontrada');
    if (tenantId && petition.tenant_id && petition.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado');
    }
    return petition;
  }

  async update(
    petitionId: string,
    data: {
      content_json?: any;
      content_html?: string;
      title?: string;
      deadline_at?: string;
      google_doc_url?: string;
      google_doc_id?: string;
    },
    tenantId?: string,
    actorUserId?: string,
  ) {
    const existing = await this.verifyPetitionAccess(petitionId, tenantId);

    // Bug fix 2026-05-10 (Peticoes PR1 #7 — CRITICO):
    // Bloquear update de content em peticao APROVADA ou PROTOCOLADA.
    // Antes advogado podia mudar valor do pedido em peca ja
    // protocolada SEM trilha de auditoria. Em incidente disciplinar
    // OAB/processo, escritorio nao consegue provar conteudo original.
    // Apenas metadata (title, deadline, google_doc_url) pode mudar
    // em status terminal — conteudo eh imutavel apos APROVADA.
    const isContentChange =
      data.content_html !== undefined || data.content_json !== undefined;
    if (isContentChange && (existing.status === 'APROVADA' || existing.status === 'PROTOCOLADA')) {
      throw new BadRequestException(
        `Peticao ${existing.status} nao pode ter conteudo alterado. ` +
        `Use POST /:id/version pra criar nova versao se precisar revisar.`,
      );
    }

    // Bug fix 2026-05-10 (Peticoes PR1 #7):
    // Auto-snapshot da versao ANTERIOR antes de aplicar mudanca de
    // conteudo. Sem isso, edits sumiam silenciosamente da trilha.
    if (isContentChange) {
      try {
        // Conta versions existentes pra setar version sequencial
        const versionCount = await this.prisma.petitionVersion.count({
          where: { petition_id: petitionId },
        });
        await this.prisma.petitionVersion.create({
          data: {
            petition_id: petitionId,
            version: versionCount + 1,
            content_html: existing.content_html || '',
            content_json: (existing.content_json || {}) as any,
            saved_by_id: actorUserId || existing.created_by_id,
          },
        });
      } catch (e: any) {
        // Se falhar nao bloqueia o update mas loga warn pra investigar
        this.logger.warn(`[PETITION] Snapshot pre-edit falhou pra ${petitionId}: ${e.message}`);
      }
    }

    const updateData: any = { updated_at: new Date() };
    if (data.content_json !== undefined) updateData.content_json = data.content_json;
    if (data.content_html !== undefined) updateData.content_html = data.content_html;
    if (data.title) updateData.title = data.title;
    if (data.deadline_at !== undefined) updateData.deadline_at = data.deadline_at ? new Date(data.deadline_at) : null;
    if (data.google_doc_url !== undefined) updateData.google_doc_url = data.google_doc_url || null;
    if (data.google_doc_id !== undefined) updateData.google_doc_id = data.google_doc_id || null;

    return this.prisma.casePetition.update({
      where: { id: petitionId },
      data: updateData,
      select: {
        id: true,
        title: true,
        status: true,
        updated_at: true,
      },
    });
  }

  async updateStatus(
    petitionId: string,
    newStatus: string,
    tenantId?: string,
  ) {
    const petition = await this.verifyPetitionAccess(petitionId, tenantId);

    if (!VALID_STATUSES.includes(newStatus as any)) {
      throw new BadRequestException(`Status inválido: ${newStatus}`);
    }

    const allowed = STATUS_TRANSITIONS[petition.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Transição inválida: ${petition.status} → ${newStatus}. Permitidos: ${allowed.join(', ') || 'nenhum'}`,
      );
    }

    const result = await this.prisma.casePetition.update({
      where: { id: petitionId },
      data: { status: newStatus },
      select: { id: true, status: true, updated_at: true },
    });

    // WebSocket: notificar advogado quando petição enviada para revisão
    if (newStatus === 'EM_REVISAO') {
      this.notifyPetitionStatusChange(petition, newStatus, petition.status).catch(() => {});
    }

    return result;
  }

  /** Notifica via WebSocket os envolvidos sobre mudança de status */
  private async notifyPetitionStatusChange(
    petition: any,
    newStatus: string,
    previousStatus: string,
    reviewNotes?: string,
  ) {
    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id: petition.legal_case_id },
      select: { lawyer_id: true },
    });

    const data = {
      petitionId: petition.id,
      title: petition.title,
      status: newStatus,
      previousStatus,
      caseId: petition.legal_case_id,
      reviewNotes,
    };

    // Notificar advogado (quando estagiário envia para revisão)
    if (newStatus === 'EM_REVISAO' && legalCase?.lawyer_id) {
      this.gateway.emitPetitionStatusChange(legalCase.lawyer_id, data);
    }

    // Notificar estagiário (quando advogado aprova ou devolve)
    if ((newStatus === 'APROVADA' || newStatus === 'RASCUNHO') && petition.created_by_id) {
      this.gateway.emitPetitionStatusChange(petition.created_by_id, { ...data, reviewNotes });
    }
  }

  /**
   * Review de petição pelo advogado: aprovar ou devolver com notas.
   */
  async reviewPetition(
    petitionId: string,
    action: 'APROVAR' | 'DEVOLVER',
    notes: string | undefined,
    reviewerId: string,
    tenantId?: string,
  ) {
    const petition = await this.verifyPetitionAccess(petitionId, tenantId);

    if (action === 'APROVAR') {
      if (petition.status !== 'EM_REVISAO') {
        throw new BadRequestException('Só é possível aprovar petições em revisão');
      }
      const result = await this.prisma.casePetition.update({
        where: { id: petitionId },
        data: {
          status: 'APROVADA',
          review_notes: notes || null,
          reviewed_by_id: reviewerId,
          reviewed_at: new Date(),
        },
        select: { id: true, status: true, review_notes: true, updated_at: true },
      });

      // WebSocket: notificar estagiário que petição foi aprovada
      this.notifyPetitionStatusChange(petition, 'APROVADA', 'EM_REVISAO', notes).catch(() => {});

      return result;
    }

    // DEVOLVER
    if (petition.status !== 'EM_REVISAO') {
      throw new BadRequestException('Só é possível devolver petições em revisão');
    }
    const devolvido = await this.prisma.casePetition.update({
      where: { id: petitionId },
      data: {
        status: 'RASCUNHO',
        review_notes: notes || null,
        reviewed_by_id: reviewerId,
        reviewed_at: new Date(),
      },
      select: { id: true, status: true, review_notes: true, updated_at: true },
    });

    // WebSocket: notificar estagiário que petição foi devolvida
    this.notifyPetitionStatusChange(petition, 'RASCUNHO', 'EM_REVISAO', notes).catch(() => {});

    return devolvido;
  }

  async saveVersion(
    petitionId: string,
    userId: string,
    tenantId?: string,
  ) {
    const petition = await this.verifyPetitionAccess(petitionId, tenantId);

    if (!petition.content_json) {
      throw new BadRequestException('Petição sem conteúdo para versionar');
    }

    // Encontrar última versão
    const lastVersion = await this.prisma.petitionVersion.findFirst({
      where: { petition_id: petitionId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const nextVersion = (lastVersion?.version || 0) + 1;

    const version = await this.prisma.petitionVersion.create({
      data: {
        petition_id: petitionId,
        version: nextVersion,
        content_json: petition.content_json as any,
        content_html: petition.content_html,
        saved_by_id: userId,
      },
      include: {
        saved_by: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Versão ${nextVersion} salva para petição ${petitionId}`);
    return version;
  }

  async findVersions(petitionId: string, tenantId?: string) {
    await this.verifyPetitionAccess(petitionId, tenantId);

    return this.prisma.petitionVersion.findMany({
      where: { petition_id: petitionId },
      select: {
        id: true,
        version: true,
        created_at: true,
        saved_by: { select: { id: true, name: true } },
      },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Sincroniza conteúdo do Google Doc para o banco de dados.
   */
  async syncFromGoogleDoc(petitionId: string, tenantId?: string) {
    const petition = await this.verifyPetitionAccess(petitionId, tenantId);

    if (!petition.google_doc_id) {
      throw new BadRequestException('Petição não possui Google Doc vinculado');
    }

    const content = await this.googleDrive.getDocContent(petition.google_doc_id);

    const updated = await this.prisma.casePetition.update({
      where: { id: petitionId },
      data: {
        content_html: content,
        updated_at: new Date(),
      },
      select: {
        id: true,
        title: true,
        content_html: true,
        google_doc_id: true,
        google_doc_url: true,
        updated_at: true,
      },
    });

    this.logger.log(`Petição ${petitionId} sincronizada do Google Doc ${petition.google_doc_id}`);
    return updated;
  }

  /**
   * Exporta petição como PDF via Google Docs.
   */
  async exportPdf(petitionId: string, tenantId?: string) {
    const petition = await this.verifyPetitionAccess(petitionId, tenantId);

    if (!petition.google_doc_id) {
      throw new BadRequestException('Petição não possui Google Doc vinculado');
    }

    const buffer = await this.googleDrive.exportAsPdf(petition.google_doc_id);

    // Bug fix 2026-05-10 (Peticoes PR3 #33):
    // Cap de 20MB. Antes Google Doc gigante derrubava memoria do
    // container — 50MB carregado em RAM por request, 10 requests
    // paralelos = 500MB RAM. Cap conservador (peca normal eh 100KB-2MB).
    const EXPORT_PDF_MAX_BYTES = 20 * 1024 * 1024;
    if (buffer.length > EXPORT_PDF_MAX_BYTES) {
      throw new BadRequestException(
        `PDF muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB, max 20MB). ` +
        `Reduza imagens ou divida em multiplos documentos.`,
      );
    }

    return { buffer, filename: `${petition.title}.pdf` };
  }

  async remove(petitionId: string, tenantId?: string) {
    const petition = await this.verifyPetitionAccess(petitionId, tenantId);

    if (petition.status !== 'RASCUNHO') {
      throw new BadRequestException(
        'Apenas petições em RASCUNHO podem ser excluídas',
      );
    }

    await this.prisma.casePetition.delete({ where: { id: petitionId } });
    this.logger.log(`Petição ${petitionId} removida`);
    return { deleted: true };
  }
}
