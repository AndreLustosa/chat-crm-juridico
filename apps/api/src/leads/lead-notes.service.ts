import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeadNotesService {
  constructor(private prisma: PrismaService) {}

  async findByLead(leadId: string) {
    return this.prisma.leadNote.findMany({
      where: { lead_id: leadId },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async create(leadId: string, userId: string, text: string) {
    return this.prisma.leadNote.create({
      data: { lead_id: leadId, user_id: userId, text },
      include: {
        user: { select: { id: true, name: true } },
      },
    });
  }

  async delete(noteId: string, userId: string, userRole: string) {
    const note = await this.prisma.leadNote.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Nota não encontrada');

    // Somente o autor ou ADMIN pode excluir
    if (note.user_id !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('Sem permissão para excluir esta nota');
    }

    await this.prisma.leadNote.delete({ where: { id: noteId } });
    return { ok: true };
  }
}
