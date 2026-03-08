import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  constructor(private prisma: PrismaService) {}

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
        created_at: true,
        updated_at: true,
        created_by: { select: { id: true, name: true } },
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
    data: { content_json?: any; content_html?: string; title?: string },
    tenantId?: string,
  ) {
    await this.verifyPetitionAccess(petitionId, tenantId);

    const updateData: any = { updated_at: new Date() };
    if (data.content_json !== undefined) updateData.content_json = data.content_json;
    if (data.content_html !== undefined) updateData.content_html = data.content_html;
    if (data.title) updateData.title = data.title;

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

    return this.prisma.casePetition.update({
      where: { id: petitionId },
      data: { status: newStatus },
      select: {
        id: true,
        status: true,
        updated_at: true,
      },
    });
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
