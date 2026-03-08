import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const VALID_TYPES = [
  'INICIAL', 'CONTESTACAO', 'RECURSO', 'MANIFESTACAO', 'OUTRO',
] as const;

@Injectable()
export class LegalTemplatesService {
  private readonly logger = new Logger(LegalTemplatesService.name);

  constructor(private prisma: PrismaService) {}

  // ─── CRUD ──────────────────────────────────────────────

  async findAll(
    tenantId?: string,
    filters?: { legal_area?: string; type?: string; search?: string },
  ) {
    const where: any = {
      OR: [
        { tenant_id: tenantId || undefined },
        { is_global: true },
      ],
    };

    if (filters?.legal_area) {
      where.legal_area = filters.legal_area;
    }
    if (filters?.type && VALID_TYPES.includes(filters.type as any)) {
      where.type = filters.type;
    }
    if (filters?.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    return this.prisma.legalTemplate.findMany({
      where,
      select: {
        id: true,
        name: true,
        type: true,
        legal_area: true,
        description: true,
        variables: true,
        is_global: true,
        usage_count: true,
        created_at: true,
        updated_at: true,
        created_by: { select: { id: true, name: true } },
      },
      orderBy: [{ usage_count: 'desc' }, { name: 'asc' }],
    });
  }

  async create(
    data: {
      name: string;
      type: string;
      legal_area?: string;
      content_json: any;
      variables?: string[];
      description?: string;
      is_global?: boolean;
    },
    userId: string,
    tenantId?: string,
  ) {
    const type = VALID_TYPES.includes(data.type as any) ? data.type : 'OUTRO';

    const template = await this.prisma.legalTemplate.create({
      data: {
        tenant_id: tenantId || null,
        created_by_id: userId,
        name: data.name,
        type,
        legal_area: data.legal_area || null,
        content_json: data.content_json,
        variables: data.variables || [],
        description: data.description || null,
        is_global: data.is_global || false,
      },
      include: {
        created_by: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Template criado: ${template.id} (${type})`);
    return template;
  }

  async findById(templateId: string, tenantId?: string) {
    const template = await this.prisma.legalTemplate.findUnique({
      where: { id: templateId },
      include: {
        created_by: { select: { id: true, name: true } },
      },
    });
    if (!template) throw new NotFoundException('Template não encontrado');

    // Verificar acesso: global ou do mesmo tenant
    if (!template.is_global && tenantId && template.tenant_id && template.tenant_id !== tenantId) {
      throw new NotFoundException('Template não encontrado');
    }

    return template;
  }

  async update(
    templateId: string,
    data: {
      name?: string;
      type?: string;
      legal_area?: string;
      content_json?: any;
      variables?: string[];
      description?: string;
    },
    tenantId?: string,
  ) {
    const template = await this.prisma.legalTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) throw new NotFoundException('Template não encontrado');
    if (tenantId && template.tenant_id && template.tenant_id !== tenantId) {
      throw new NotFoundException('Template não encontrado');
    }
    // Não permitir editar templates globais por tenant
    if (template.is_global && tenantId) {
      throw new BadRequestException('Templates globais não podem ser editados');
    }

    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.type && VALID_TYPES.includes(data.type as any)) updateData.type = data.type;
    if (data.legal_area !== undefined) updateData.legal_area = data.legal_area || null;
    if (data.content_json !== undefined) updateData.content_json = data.content_json;
    if (data.variables) updateData.variables = data.variables;
    if (data.description !== undefined) updateData.description = data.description || null;

    return this.prisma.legalTemplate.update({
      where: { id: templateId },
      data: updateData,
      include: {
        created_by: { select: { id: true, name: true } },
      },
    });
  }

  async remove(templateId: string, tenantId?: string, force = false) {
    const template = await this.prisma.legalTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) throw new NotFoundException('Template não encontrado');
    if (tenantId && template.tenant_id && template.tenant_id !== tenantId) {
      throw new NotFoundException('Template não encontrado');
    }
    if (template.is_global && tenantId) {
      throw new BadRequestException('Templates globais não podem ser excluídos');
    }

    if (template.usage_count > 0 && !force) {
      throw new BadRequestException(
        `Template em uso por ${template.usage_count} petição(ões). Use force=true para excluir.`,
      );
    }

    await this.prisma.legalTemplate.delete({ where: { id: templateId } });
    this.logger.log(`Template ${templateId} removido`);
    return { deleted: true };
  }
}
