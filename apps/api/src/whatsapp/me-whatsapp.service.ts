import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';

/**
 * Conexão self-service do WhatsApp por escritório (multi-tenant).
 *
 * Tudo é derivado de req.user.tenant_id (o cliente NÃO passa instanceName →
 * sem IDOR). Garante o vínculo que o webhook exige: Instance.tenant_id +
 * Inbox.tenant_id. Reusa a instância JÁ existente do tenant (ex.: número já
 * conectado) e só cria uma nova quando o escritório ainda não tem nenhuma.
 */
@Injectable()
export class MeWhatsappService {
  private readonly logger = new Logger(MeWhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /** Nome estável/único por tenant (sem dado sensível, sem input do cliente). */
  private defaultName(tenantId: string): string {
    return `jf_${tenantId.replace(/-/g, '').slice(0, 16)}`;
  }

  private async tenantInstanceName(tenantId: string): Promise<{ name: string; existing: boolean; inboxId?: string }> {
    const inst = await (this.prisma as any).instance.findFirst({
      where: { tenant_id: tenantId, type: 'whatsapp' },
      orderBy: { created_at: 'asc' },
      select: { name: true, inbox_id: true },
    });
    if (inst) return { name: inst.name, existing: true, inboxId: inst.inbox_id ?? undefined };
    return { name: this.defaultName(tenantId), existing: false };
  }

  /** Garante Inbox + Instance (com tenant_id) e devolve o QR/pairing pra conectar. */
  async connect(tenantId: string | undefined) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const { name, existing, inboxId } = await this.tenantInstanceName(tenantId);

    // 1. Inbox do tenant (âncora de roteamento). Reusa a 1ª; cria se não houver.
    let inbox = await (this.prisma as any).inbox.findFirst({ where: { tenant_id: tenantId } });
    if (!inbox) {
      inbox = await (this.prisma as any).inbox.create({ data: { name: 'WhatsApp', tenant_id: tenantId } });
    }

    // 2. Instance local COM tenant_id — âncora do webhook (sem isso, payload é rejeitado).
    await (this.prisma as any).instance.upsert({
      where: { name },
      update: { tenant_id: tenantId, inbox_id: inboxId ?? inbox.id, type: 'whatsapp' },
      create: { name, tenant_id: tenantId, inbox_id: inbox.id, type: 'whatsapp' },
    });

    // 3. Já conectado? Não precisa de QR.
    try {
      const st: any = await this.whatsapp.getConnectionStatus(name);
      if ((st?.instance?.state ?? st?.state) === 'open') {
        return { instanceName: name, alreadyConnected: true };
      }
    } catch {
      // instância ainda não existe na Evolution → segue para criar
    }

    // 4. Cria na Evolution se for nova (createInstance já configura o webhook).
    if (!existing) {
      try {
        await this.whatsapp.createInstance(name);
      } catch (e: any) {
        this.logger.warn(`createInstance(${name}) — provavelmente já existe: ${e?.message ?? e}`);
      }
    }

    // 5. QR + pairing code
    const conn: any = await this.whatsapp.getConnectCode(name);
    return {
      instanceName: name,
      alreadyConnected: false,
      qr: conn?.base64 ?? null, // data URL da imagem do QR
      code: conn?.code ?? null, // string do QR (fallback)
      pairingCode: conn?.pairingCode ?? null,
    };
  }

  /** Estado da conexão do WhatsApp do escritório logado. */
  async status(tenantId: string | undefined) {
    if (!tenantId) return { state: 'none' as const };
    const { name, existing } = await this.tenantInstanceName(tenantId);
    if (!existing) return { state: 'none' as const, instanceName: name };
    try {
      const st: any = await this.whatsapp.getConnectionStatus(name);
      return { state: st?.instance?.state ?? st?.state ?? 'close', instanceName: name };
    } catch {
      return { state: 'close' as const, instanceName: name };
    }
  }

  /** Desconecta (logout) o WhatsApp do escritório logado. */
  async disconnect(tenantId: string | undefined) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const { name, existing } = await this.tenantInstanceName(tenantId);
    if (existing) await this.whatsapp.logoutInstance(name).catch(() => {});
    return { ok: true };
  }

  // ─── Multi-departamento (Fase 1): cada departamento = 1 Inbox + 1 número ──────
  //
  // Generaliza o fluxo acima (que é singleton por tenant) para operar por INBOX.
  // Cada inbox = um "departamento" (Comercial, Financeiro...) com seu próprio
  // número. O inboxId vem da URL, então TODO acesso valida que o inbox é do
  // tenant logado (assertInbox) — sem IDOR.

  /** Nome estável/único da instância de um departamento (inbox). */
  private deptInstanceName(tenantId: string, inboxId: string): string {
    return `jf_${tenantId.replace(/-/g, '').slice(0, 16)}_${inboxId.replace(/-/g, '').slice(0, 8)}`;
  }

  /** Garante que o inbox pertence ao tenant (anti-IDOR). Devolve o inbox. */
  private async assertInbox(tenantId: string, inboxId: string) {
    const inbox = await (this.prisma as any).inbox.findFirst({ where: { id: inboxId, tenant_id: tenantId } });
    if (!inbox) throw new NotFoundException('Departamento não encontrado.');
    return inbox;
  }

  /** Instância WhatsApp do departamento (reusa a existente ou define o nome novo). */
  private async deptInstance(tenantId: string, inboxId: string): Promise<{ name: string; existing: boolean }> {
    const inst = await (this.prisma as any).instance.findFirst({
      where: { tenant_id: tenantId, inbox_id: inboxId, type: 'whatsapp' },
      orderBy: { created_at: 'asc' },
      select: { name: true },
    });
    if (inst) return { name: inst.name, existing: true };
    return { name: this.deptInstanceName(tenantId, inboxId), existing: false };
  }

  /** Cria um departamento (Inbox) do escritório. */
  async createDepartment(tenantId: string | undefined, name: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const nome = (name ?? '').trim();
    if (!nome) throw new BadRequestException('Informe o nome do departamento.');
    return (this.prisma as any).inbox.create({ data: { name: nome, tenant_id: tenantId } });
  }

  /** Lista os departamentos (inboxes) do escritório + status do WhatsApp de cada um. */
  async listDepartments(tenantId: string | undefined) {
    if (!tenantId) return [];
    const inboxes = await (this.prisma as any).inbox.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'asc' },
      include: {
        instances: { where: { type: 'whatsapp' }, select: { name: true }, orderBy: { created_at: 'asc' }, take: 1 },
        _count: { select: { users: true, conversations: true } },
      },
    });
    return Promise.all(
      inboxes.map(async (ib: any) => {
        const instanceName: string | null = ib.instances?.[0]?.name ?? null;
        let state = 'none';
        if (instanceName) {
          try {
            const st: any = await this.whatsapp.getConnectionStatus(instanceName);
            state = st?.instance?.state ?? st?.state ?? 'close';
          } catch {
            state = 'close';
          }
        }
        return {
          id: ib.id,
          name: ib.name,
          users_count: ib._count?.users ?? 0,
          conversations_count: ib._count?.conversations ?? 0,
          instanceName,
          state,
        };
      }),
    );
  }

  /** Provisiona/conecta o número de um departamento e devolve o QR/pairing. */
  async connectInbox(tenantId: string | undefined, inboxId: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    await this.assertInbox(tenantId, inboxId);
    const { name, existing } = await this.deptInstance(tenantId, inboxId);

    await (this.prisma as any).instance.upsert({
      where: { name },
      update: { tenant_id: tenantId, inbox_id: inboxId, type: 'whatsapp' },
      create: { name, tenant_id: tenantId, inbox_id: inboxId, type: 'whatsapp' },
    });

    try {
      const st: any = await this.whatsapp.getConnectionStatus(name);
      if ((st?.instance?.state ?? st?.state) === 'open') {
        return { instanceName: name, alreadyConnected: true };
      }
    } catch {
      // instância ainda não existe na Evolution → segue para criar
    }
    if (!existing) {
      try {
        await this.whatsapp.createInstance(name);
      } catch (e: any) {
        this.logger.warn(`createInstance(${name}) — provavelmente já existe: ${e?.message ?? e}`);
      }
    }
    const conn: any = await this.whatsapp.getConnectCode(name);
    return {
      instanceName: name,
      alreadyConnected: false,
      qr: conn?.base64 ?? null,
      code: conn?.code ?? null,
      pairingCode: conn?.pairingCode ?? null,
    };
  }

  /** Estado da conexão do número de um departamento. */
  async statusInbox(tenantId: string | undefined, inboxId: string) {
    if (!tenantId) return { state: 'none' as const };
    await this.assertInbox(tenantId, inboxId);
    const inst = await (this.prisma as any).instance.findFirst({
      where: { tenant_id: tenantId, inbox_id: inboxId, type: 'whatsapp' },
      orderBy: { created_at: 'asc' },
      select: { name: true },
    });
    if (!inst) return { state: 'none' as const };
    try {
      const st: any = await this.whatsapp.getConnectionStatus(inst.name);
      return { state: st?.instance?.state ?? st?.state ?? 'close', instanceName: inst.name };
    } catch {
      return { state: 'close' as const, instanceName: inst.name };
    }
  }

  /** Desconecta (logout) o número de um departamento. */
  async disconnectInbox(tenantId: string | undefined, inboxId: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    await this.assertInbox(tenantId, inboxId);
    const inst = await (this.prisma as any).instance.findFirst({
      where: { tenant_id: tenantId, inbox_id: inboxId, type: 'whatsapp' },
      orderBy: { created_at: 'asc' },
      select: { name: true },
    });
    if (inst) await this.whatsapp.logoutInstance(inst.name).catch(() => {});
    return { ok: true };
  }

  /**
   * Exclui um departamento por completo: apaga as instâncias NA EVOLUTION
   * (logout + delete — senão ficam órfãs lá), remove os registros locais de
   * Instance, desvincula as conversas (não apaga) e remove o Inbox.
   */
  async deleteDepartment(tenantId: string | undefined, inboxId: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    await this.assertInbox(tenantId, inboxId);
    const insts = await (this.prisma as any).instance.findMany({
      where: { tenant_id: tenantId, inbox_id: inboxId },
      select: { name: true },
    });
    for (const i of insts) {
      await this.whatsapp.logoutInstance(i.name).catch(() => {});
      await this.whatsapp
        .deleteInstance(i.name)
        .catch((e: any) => this.logger.warn(`deleteInstance(${i.name}) falhou: ${e?.message ?? e}`));
    }
    await (this.prisma as any).conversation.updateMany({ where: { inbox_id: inboxId }, data: { inbox_id: null } });
    await (this.prisma as any).instance.deleteMany({ where: { tenant_id: tenantId, inbox_id: inboxId } });
    await (this.prisma as any).inbox.delete({ where: { id: inboxId } });
    return { ok: true };
  }
}
