import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LeadNotesService — anotacoes internas do escritorio sobre o lead/cliente.
 *
 * Bug fix 2026-05-12 (Leads PR1 #C7 — CRITICO — SIGILO PROFISSIONAL):
 *
 * Antes:
 *   - findByLead(leadId) NAO recebia tenantId — qualquer user de tenant A
 *     listava notas internas (sigilo profissional!) de lead tenant B.
 *   - create(leadId, userId, text) NAO validava que lead pertence ao tenant
 *     do user — criava nota em lead alheio.
 *   - delete usava req.user?.role (singular) mas schema tem roles[] plural.
 *     Check `userRole !== 'ADMIN'` SEMPRE passava (string !== array sempre
 *     true) → qualquer user deletava notas.
 *
 * Agora:
 *   - Todos os metodos exigem tenantId + validam lead.tenant_id === tenantId
 *   - delete usa Array.includes em vez de strict compare
 *   - Audit log em create e delete
 */
@Injectable()
export class LeadNotesService {
  constructor(private prisma: PrismaService) {}

  private async assertLeadInTenant(leadId: string, tenantId: string): Promise<void> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!lead) {
      throw new NotFoundException('Lead nao encontrado');
    }
  }

  async findByLead(leadId: string, tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio');
    }
    await this.assertLeadInTenant(leadId, tenantId);
    return this.prisma.leadNote.findMany({
      where: { lead_id: leadId },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async create(leadId: string, userId: string, text: string, tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio');
    }
    await this.assertLeadInTenant(leadId, tenantId);
    const note = await this.prisma.leadNote.create({
      data: { lead_id: leadId, user_id: userId, text },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actor_user_id: userId,
        action: 'lead_note_create',
        entity: 'LeadNote',
        entity_id: note.id,
        meta_json: {
          tenant_id: tenantId,
          lead_id: leadId,
          text_preview: text.slice(0, 100),
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    return note;
  }

  async delete(noteId: string, userId: string, userRoles: string[] | string | undefined, tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('tenant_id obrigatorio');
    }
    // Bug fix #C7: busca nota com tenant via JOIN
    const note = await this.prisma.leadNote.findFirst({
      where: {
        id: noteId,
        lead: { tenant_id: tenantId },
      },
      select: { id: true, user_id: true, lead_id: true, text: true },
    });
    if (!note) throw new NotFoundException('Nota não encontrada');

    // Bug fix #C7: schema tem User.roles String[] — usar Array.includes em
    // vez de string compare. Antes: `userRole !== 'ADMIN'` com userRole sendo
    // array sempre era true → qualquer user deletava.
    const rolesArr: string[] = Array.isArray(userRoles)
      ? userRoles
      : (typeof userRoles === 'string' ? [userRoles] : []);
    const isAdmin = rolesArr.includes('ADMIN');

    // Somente o autor ou ADMIN pode excluir
    if (note.user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Sem permissão para excluir esta nota');
    }

    await this.prisma.leadNote.delete({ where: { id: noteId } });

    await this.prisma.auditLog.create({
      data: {
        actor_user_id: userId,
        action: 'lead_note_delete',
        entity: 'LeadNote',
        entity_id: noteId,
        meta_json: {
          tenant_id: tenantId,
          lead_id: note.lead_id,
          text_preview: note.text?.slice(0, 100) || null,
          was_author: note.user_id === userId,
        },
      },
    }).catch(() => { /* nao bloqueia */ });

    return { ok: true };
  }
}
