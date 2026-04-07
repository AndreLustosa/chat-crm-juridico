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

const VALID_TYPES = [
  'INICIAL', 'CONTESTACAO', 'REPLICA', 'EMBARGOS',
  'RECURSO', 'MANIFESTACAO', 'OUTRO',
] as const;

const VALID_STATUSES = [
  'RASCUNHO', 'EM_REVISAO', 'APROVADA', 'PROTOCOLADA',
] as const;

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

    // Se vem de template, copiar conteúdo e incrementar usage_count
    if (data.template_id) {
      const template = await this.prisma.legalTemplate.findUnique({
        where: { id: data.template_id },
      });
      if (template) {
        contentJson = template.content_json;
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
          this.logger.log(`Google Drive configurado. Criando Doc para petição "${data.title}" no caso ${caseId}...`);
          const legalCase = await this.prisma.legalCase.findUnique({
            where: { id: caseId },
            select: { lead_id: true, legal_area: true, case_number: true },
          });
          if (legalCase) {
            const caseLabel = [legalCase.legal_area, legalCase.case_number || 'Novo Caso']
              .filter(Boolean)
              .join(' - ');

            this.logger.log(`Criando pasta do caso: ${caseLabel}`);
            const folderId = await this.googleDrive.ensureCaseFolder(
              caseId,
              legalCase.lead_id,
              caseLabel,
            );
            this.logger.log(`Pasta do caso OK: ${folderId}. Criando Google Doc...`);

            const doc = await this.googleDrive.createDoc(
              data.title,
              folderId,
              contentHtml || undefined,
            );
            googleDocId = doc.docId;
            googleDocUrl = doc.docUrl;
            this.logger.log(`Google Doc criado com sucesso: ${googleDocId} - ${googleDocUrl}`);
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
        tenant_id: tenantId || null,
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
  ) {
    await this.verifyPetitionAccess(petitionId, tenantId);

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

    // Salva na memória quando petição é aprovada ou protocolada
    if (newStatus === 'APROVADA' || newStatus === 'PROTOCOLADA') {
      this.appendPetitionToMemory(petition, newStatus).catch(err =>
        this.logger.warn(`[MEMORY] Falha ao registrar petição na memória: ${err}`),
      );
    }

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

  private async appendPetitionToMemory(petition: any, newStatus: string): Promise<void> {
    const legalCase = await this.prisma.legalCase.findUnique({
      where: { id: petition.legal_case_id },
      select: { lead_id: true, case_number: true },
    });
    if (!legalCase?.lead_id) return;

    const today = new Date().toISOString().slice(0, 10);
    const entry = { type: petition.type, title: petition.title, status: newStatus, date: today, case_number: legalCase.case_number };

    const existing = await this.prisma.aiMemory.findUnique({ where: { lead_id: legalCase.lead_id } });
    let facts: any = {};
    try { facts = existing?.facts_json ? (typeof existing.facts_json === 'string' ? JSON.parse(existing.facts_json as string) : existing.facts_json) : {}; } catch { facts = {}; }
    const petitions: any[] = facts.petitions || [];
    petitions.push(entry);
    if (petitions.length > 20) petitions.splice(0, petitions.length - 20);
    facts.petitions = petitions;

    const STATUS_LABEL: Record<string, string> = { APROVADA: 'aprovada', PROTOCOLADA: 'protocolada' };
    const summaryLine = `[PETIÇÃO ${today}] ${petition.type} ${STATUS_LABEL[newStatus] || newStatus}: ${petition.title}`;
    const newSummary = (summaryLine + (existing?.summary ? '\n' + existing.summary : '')).slice(0, 2000);

    if (existing) {
      await this.prisma.aiMemory.update({
        where: { lead_id: legalCase.lead_id },
        data: { facts_json: facts, summary: newSummary, last_updated_at: new Date(), version: { increment: 1 } },
      });
    } else {
      await this.prisma.aiMemory.create({ data: { lead_id: legalCase.lead_id, summary: newSummary, facts_json: facts } });
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

      this.appendPetitionToMemory(petition, 'APROVADA').catch(err =>
        this.logger.warn(`[MEMORY] Falha ao registrar petição na memória: ${err}`),
      );

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
