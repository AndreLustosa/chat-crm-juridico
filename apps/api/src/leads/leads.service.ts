import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Lead } from '@crm/shared';
import { LegalCasesService } from '../legal-cases/legal-cases.service';

/**
 * Remove o nono dígito de celulares brasileiros.
 * 13 dígitos (55+DD+9+8dig) → 12 dígitos (55+DD+8dig)
 * Ex: 5582999130127 → 558299130127
 */
function to12Digits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
    return d.slice(0, 4) + d.slice(5); // remove o 5º caractere (o 9)
  }
  return d;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private legalCasesService: LegalCasesService,
  ) {}

  async create(data: Prisma.LeadCreateInput): Promise<Lead> {
    if (data.phone) data = { ...data, phone: to12Digits(data.phone) };
    return this.prisma.lead.create({ data });
  }

  async findAll(tenant_id?: string, inbox_id?: string): Promise<Lead[]> {
    const baseWhere = tenant_id
      ? { OR: [{ tenant_id }, { tenant_id: null }] }
      : undefined;

    const where = inbox_id
      ? {
          ...baseWhere,
          conversations: { some: { inbox_id } },
        }
      : baseWhere;

    return (await this.prisma.lead.findMany({
      where,
      include: {
        _count: {
          select: { conversations: true },
        },
        conversations: {
          where: inbox_id ? { inbox_id } : undefined,
          orderBy: { last_message_at: 'desc' },
          take: 1,
          include: {
            messages: {
              orderBy: { created_at: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    })) as any;
  }

  async findOne(id: string): Promise<Lead | null> {
    return this.prisma.lead.findUnique({
      where: { id },
      include: {
        memory: true,
        conversations: {
          orderBy: { last_message_at: 'desc' },
          include: {
            assigned_user: { select: { id: true, name: true } },
            messages: {
              orderBy: { created_at: 'desc' },
              take: 1,
            },
          },
        },
        tasks: {
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        _count: {
          select: { conversations: true },
        },
      },
    }) as any;
  }

  async upsert(data: Prisma.LeadCreateInput): Promise<Lead> {
    const phone = to12Digits(data.phone);
    const { phone: _phone, name: _name, ...rest } = data;

    this.logger.debug(`Upsert lead: raw=${data.phone} → stored=${phone}`);

    // No UPDATE nunca sobrescreve o nome com o pushName do WhatsApp.
    // O pushName é apenas um placeholder inicial (pode ser número de telefone,
    // apelido ou nome de perfil do WhatsApp). O nome real é capturado pela IA
    // quando o contato o informa explicitamente durante o atendimento.
    // Na criação do lead (create) o nome do WhatsApp ainda é usado como fallback inicial.
    const updateData: any = { ...rest };

    return this.prisma.lead.upsert({
      where: { phone },
      update: updateData,
      create: { ...data, phone },
    });
  }

  async findByPhone(phone: string): Promise<Lead | null> {
    const normalized = to12Digits(phone);
    return this.prisma.lead.findFirst({
      where: { OR: [{ phone: normalized }, { phone }] },
    });
  }

  async checkPhone(phone: string): Promise<{ exists: boolean; lead?: Lead }> {
    const found = await this.findByPhone(phone);
    if (!found) return { exists: false };
    return { exists: true, lead: found };
  }

  async update(id: string, data: { name?: string; email?: string; tags?: string[] }): Promise<Lead> {
    return this.prisma.lead.update({
      where: { id },
      data,
    });
  }

  async updateStatus(id: string, stage: string): Promise<Lead> {
    const lead = await this.prisma.lead.update({
      where: { id },
      data: { stage },
    });

    // Auto-criação de LegalCase quando lead atinge FINALIZADO
    if (stage === 'FINALIZADO') {
      try {
        const conv = await this.prisma.conversation.findFirst({
          where: { lead_id: id, assigned_lawyer_id: { not: null } },
          orderBy: { last_message_at: 'desc' },
          select: { id: true, assigned_lawyer_id: true, tenant_id: true, legal_area: true },
        });
        if (conv?.assigned_lawyer_id) {
          await this.legalCasesService.createFromFinalizado(
            id,
            conv.assigned_lawyer_id,
            conv.id,
            conv.tenant_id ?? undefined,
          );
          this.logger.log(`Auto-created LegalCase for lead ${id} → lawyer ${conv.assigned_lawyer_id}`);
        }
      } catch (err) {
        this.logger.warn(`Failed to auto-create LegalCase for lead ${id}: ${err}`);
      }
    }

    return lead;
  }

  async resetMemory(id: string): Promise<{ ok: boolean }> {
    await this.prisma.aiMemory.deleteMany({ where: { lead_id: id } });
    return { ok: true };
  }

  // ─── DELETE CONTACT (somente ADMIN) ──────────────────────────────────────
  // Exclui o contato e TODOS os seus dados: conversas, mensagens, memória IA,
  // casos jurídicos, tarefas, eventos, publicações DJEN.
  async deleteContact(id: string): Promise<{ ok: boolean }> {
    const lead = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!lead) throw new NotFoundException('Contato não encontrado');

    await this.prisma.$transaction(async (tx) => {
      // 1. Coleta todos os IDs relacionados
      const conversations = await tx.conversation.findMany({
        where: { lead_id: id },
        select: { id: true },
      });
      const convIds = conversations.map(c => c.id);

      const legalCases = await tx.legalCase.findMany({
        where: { lead_id: id },
        select: { id: true },
      });
      const caseIds = legalCases.map(c => c.id);

      const messages = convIds.length > 0
        ? await tx.message.findMany({
            where: { conversation_id: { in: convIds } },
            select: { id: true },
          })
        : [];
      const msgIds = messages.map(m => m.id);

      const allTasks = await tx.task.findMany({
        where: {
          OR: [
            { lead_id: id },
            ...(caseIds.length > 0 ? [{ legal_case_id: { in: caseIds } }] : []),
            ...(convIds.length > 0 ? [{ conversation_id: { in: convIds } }] : []),
          ],
        },
        select: { id: true },
      });
      const taskIds = allTasks.map(t => t.id);

      // 2. Exclui na ordem correta (filhos antes de pais)

      // Comentários de tarefas
      if (taskIds.length > 0) {
        await tx.taskComment.deleteMany({ where: { task_id: { in: taskIds } } });
      }

      // Publicações DJEN dos casos
      if (caseIds.length > 0) {
        await tx.djenPublication.deleteMany({ where: { legal_case_id: { in: caseIds } } });
      }

      // Eventos dos casos
      if (caseIds.length > 0) {
        await tx.caseEvent.deleteMany({ where: { case_id: { in: caseIds } } });
      }

      // Tarefas (do lead, dos casos e das conversas)
      if (taskIds.length > 0) {
        await tx.task.deleteMany({ where: { id: { in: taskIds } } });
      }

      // Casos jurídicos
      if (caseIds.length > 0) {
        await tx.legalCase.deleteMany({ where: { id: { in: caseIds } } });
      }

      // Mídia das mensagens
      if (msgIds.length > 0) {
        await tx.media.deleteMany({ where: { message_id: { in: msgIds } } });
        await tx.message.deleteMany({ where: { id: { in: msgIds } } });
      }

      // Conversas
      if (convIds.length > 0) {
        await tx.conversation.deleteMany({ where: { id: { in: convIds } } });
      }

      // Memória IA
      await tx.aiMemory.deleteMany({ where: { lead_id: id } });

      // Lead em si
      await tx.lead.delete({ where: { id } });
    }, { timeout: 30000 }); // timeout generoso para contatos com muito histórico

    this.logger.log(`[deleteContact] Contato ${id} e todos os seus dados foram excluídos.`);
    return { ok: true };
  }
}
