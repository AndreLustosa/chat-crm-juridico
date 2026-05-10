import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { tenantOrDefault } from '../common/constants/tenant';

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
    // Bug fix 2026-05-10 (Peticoes PR1 #8 — CRITICO):
    // Antes `tenant_id: tenantId || undefined` — quando tenantId era
    // undefined, Prisma traduzia `tenant_id: undefined` como "ignorar
    // filtro" → OR virava `[{}, { is_global: true }]` → retornava
    // TODOS templates de TODOS os tenants (vazamento PI juridica).
    // Agora: se tenantId ausente, OR cobre so is_global.
    const where: any = tenantId
      ? {
          OR: [
            { tenant_id: tenantId },
            { is_global: true },
          ],
        }
      : { is_global: true }; // Sem tenant — apenas templates globais

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
        tenant_id: tenantOrDefault(tenantId),
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
    actorUserId?: string,
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

    // Bug fix 2026-05-10 (Peticoes PR2 #22):
    // Audit log antes do update — captura before/after pra investigar
    // template alterado erroneamente (peticoes futuras saem com novo
    // conteudo, sem trilha de quem mudou e quando).
    this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'update',
        entity: 'LegalTemplate',
        entity_id: templateId,
        meta_json: {
          before: {
            name: template.name,
            type: template.type,
            legal_area: template.legal_area,
            description: template.description,
            // content_json eh grande — guarda hash em vez do conteudo
            content_hash: template.content_json
              ? require('crypto').createHash('sha256').update(JSON.stringify(template.content_json)).digest('hex').slice(0, 16)
              : null,
          },
          after: data,
        } as any,
      },
    }).catch((e: any) => {
      this.logger.warn(`[TEMPLATE-AUDIT] Falha ao gravar log: ${e.message}`);
    });

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
