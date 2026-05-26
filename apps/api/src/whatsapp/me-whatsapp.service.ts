import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
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

  /** Slug seguro pra nome de instância (sem acento/espaço/caractere especial). */
  private slug(s: string): string {
    return (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico → hífen
      .replace(/^-+|-+$/g, '') // trim hífens das pontas
      .slice(0, 24);
  }

  /**
   * Nome LEGÍVEL e único da instância: "<escritorio>_<departamento>_<id8>".
   * O sufixo (8 chars do inbox.id) garante unicidade global na Evolution
   * compartilhada. Ex.: "andre-lustosa-advogados_comercial_0edd1f2a".
   */
  private deptInstanceName(officeName: string, deptName: string, inboxId: string): string {
    const office = this.slug(officeName) || 'escritorio';
    const dept = this.slug(deptName) || 'depto';
    const uniq = inboxId.replace(/-/g, '').slice(0, 8);
    return `${office}_${dept}_${uniq}`;
  }

  /** Garante que o inbox pertence ao tenant (anti-IDOR). Devolve o inbox. */
  private async assertInbox(tenantId: string, inboxId: string) {
    const inbox = await (this.prisma as any).inbox.findFirst({ where: { id: inboxId, tenant_id: tenantId } });
    if (!inbox) throw new NotFoundException('Departamento não encontrado.');
    return inbox;
  }

  /** Instância WhatsApp do departamento (reusa a existente ou define o nome legível novo). */
  private async deptInstance(
    tenantId: string,
    inbox: { id: string; name: string },
  ): Promise<{ name: string; existing: boolean }> {
    const inst = await (this.prisma as any).instance.findFirst({
      where: { tenant_id: tenantId, inbox_id: inbox.id, type: 'whatsapp' },
      orderBy: { created_at: 'asc' },
      select: { name: true },
    });
    if (inst) return { name: inst.name, existing: true };
    const tenant = await (this.prisma as any).tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    return { name: this.deptInstanceName(tenant?.name ?? '', inbox.name, inbox.id), existing: false };
  }

  /** Cria um departamento (Inbox) do escritório. */
  async createDepartment(tenantId: string | undefined, name: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const nome = (name ?? '').trim();
    if (!nome) throw new BadRequestException('Informe o nome do departamento.');
    return (this.prisma as any).inbox.create({ data: { name: nome, tenant_id: tenantId } });
  }

  /** Lista os departamentos (inboxes) do escritório + TODOS os números de cada um. */
  async listDepartments(tenantId: string | undefined) {
    if (!tenantId) return [];
    const inboxes = await (this.prisma as any).inbox.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'asc' },
      include: {
        instances: {
          where: { type: 'whatsapp' },
          select: { id: true, name: true, number: true },
          orderBy: { created_at: 'asc' },
        },
        _count: { select: { users: true, conversations: true } },
      },
    });

    // UMA chamada à Evolution traz estado + número conectado de TODAS as instâncias.
    const evo = await this.whatsapp.getEvolutionMap();

    return inboxes.map((ib: any) => {
      const numbers = (ib.instances ?? []).map((inst: any) => {
        const e = evo.get(inst.name);
        return {
          id: inst.id,
          instanceName: inst.name,
          number: e?.number ?? inst.number ?? null, // número ao vivo; cai pro salvo
          state: e?.state ?? 'close',
        };
      });
      return {
        id: ib.id,
        name: ib.name,
        users_count: ib._count?.users ?? 0,
        conversations_count: ib._count?.conversations ?? 0,
        numbers,
        // Compat com telas antigas: "primário" = primeiro número.
        instanceName: numbers[0]?.instanceName ?? null,
        state: numbers[0]?.state ?? 'none',
      };
    });
  }

  /** Provisiona/conecta o número de um departamento e devolve o QR/pairing. */
  async connectInbox(tenantId: string | undefined, inboxId: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const inbox = await this.assertInbox(tenantId, inboxId);
    const { name, existing } = await this.deptInstance(tenantId, inbox);

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

  // ─── Multi-número por departamento (Fase 3) + TRAVA de número duplicado ───────
  //
  // Um departamento (Inbox) pode ter VÁRIOS números (Instances). Cada número é
  // operado pelo seu id (conectar/QR, status, desconectar, excluir). A TRAVA
  // impede ligar o MESMO número em dois departamentos do escritório — duas
  // sessões Baileys no mesmo número causam quedas e risco de ban.

  /** Nome único de instância para um NOVO número do departamento. */
  private buildInstanceName(officeName: string, deptName: string): string {
    const office = this.slug(officeName) || 'escritorio';
    const dept = this.slug(deptName) || 'depto';
    const uniq = crypto.randomBytes(5).toString('hex'); // 10 chars hex
    return `${office}_${dept}_${uniq}`;
  }

  /** Garante que a instância (número) pertence ao tenant (anti-IDOR). */
  private async assertInstance(tenantId: string, instanceId: string) {
    const inst = await (this.prisma as any).instance.findFirst({
      where: { id: instanceId, tenant_id: tenantId, type: 'whatsapp' },
      select: { id: true, name: true, number: true, inbox_id: true },
    });
    if (!inst) throw new NotFoundException('Número não encontrado.');
    return inst as { id: string; name: string; number: string | null; inbox_id: string | null };
  }

  /**
   * Chamado quando a instância está "open": lê o número conectado e aplica a
   * TRAVA. Se o número já estiver ATIVO em outra instância do tenant → desconecta
   * esta (mata a sessão duplicada) e devolve 'conflict'. Senão, salva o número.
   */
  private async finalizeNumber(tenantId: string, inst: { id: string; name: string; number: string | null }) {
    // Já validado nesta sessão → caminho rápido (sem nova chamada à Evolution).
    if (inst.number) return { state: 'open' as const, instanceName: inst.name, number: inst.number };

    const evo = await this.whatsapp.getEvolutionMap();
    const owner = evo.get(inst.name)?.number ?? null;
    if (!owner) return { state: 'open' as const, instanceName: inst.name, number: null }; // ownerJid ainda não disponível

    // Compara com os números AO VIVO das OUTRAS instâncias do escritório
    // (pega até número legado salvo como null, pois usa o estado real da Evolution).
    const mine = await (this.prisma as any).instance.findMany({
      where: { tenant_id: tenantId, type: 'whatsapp', id: { not: inst.id } },
      select: { id: true, name: true, inbox: { select: { name: true } } },
    });
    const clash = mine.find((o: any) => (evo.get(o.name)?.number ?? null) === owner);
    if (clash) {
      await this.whatsapp.logoutInstance(inst.name).catch(() => {}); // mata a sessão duplicada na hora
      await (this.prisma as any).instance.update({ where: { id: inst.id }, data: { number: null } }).catch(() => {});
      return {
        state: 'conflict' as const,
        instanceName: inst.name,
        number: owner,
        conflictWith: clash.inbox?.name ?? 'outro departamento',
      };
    }
    await (this.prisma as any).instance.update({ where: { id: inst.id }, data: { number: owner } }).catch(() => {});
    return { state: 'open' as const, instanceName: inst.name, number: owner };
  }

  /** Adiciona um NOVO número ao departamento e devolve o QR/pairing. */
  async addNumber(tenantId: string | undefined, inboxId: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const inbox = await this.assertInbox(tenantId, inboxId);
    const tenant = await (this.prisma as any).tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const name = this.buildInstanceName(tenant?.name ?? '', inbox.name);

    const created = await (this.prisma as any).instance.create({
      data: { name, tenant_id: tenantId, inbox_id: inboxId, type: 'whatsapp', number: null },
      select: { id: true, name: true },
    });
    try {
      await this.whatsapp.createInstance(name);
    } catch (e: any) {
      this.logger.warn(`createInstance(${name}) — provavelmente já existe: ${e?.message ?? e}`);
    }
    const conn: any = await this.whatsapp.getConnectCode(name);
    return {
      instanceId: created.id,
      instanceName: name,
      alreadyConnected: false,
      qr: conn?.base64 ?? null,
      code: conn?.code ?? null,
      pairingCode: conn?.pairingCode ?? null,
    };
  }

  /** (Re)conecta um número existente: zera a validação e devolve um QR novo. */
  async connectNumber(tenantId: string | undefined, instanceId: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const inst = await this.assertInstance(tenantId, instanceId);

    // Zera o número salvo → a TRAVA revalida nesta nova conexão.
    await (this.prisma as any).instance.update({ where: { id: inst.id }, data: { number: null } }).catch(() => {});

    try {
      const st: any = await this.whatsapp.getConnectionStatus(inst.name);
      if ((st?.instance?.state ?? st?.state) === 'open') {
        return { instanceId: inst.id, instanceName: inst.name, alreadyConnected: true };
      }
    } catch {
      // não existe na Evolution → cria abaixo
    }
    try {
      await this.whatsapp.createInstance(inst.name);
    } catch (e: any) {
      this.logger.warn(`createInstance(${inst.name}) — provavelmente já existe: ${e?.message ?? e}`);
    }
    const conn: any = await this.whatsapp.getConnectCode(inst.name);
    return {
      instanceId: inst.id,
      instanceName: inst.name,
      alreadyConnected: false,
      qr: conn?.base64 ?? null,
      code: conn?.code ?? null,
      pairingCode: conn?.pairingCode ?? null,
    };
  }

  /** Estado de um número específico (+ aplica a TRAVA quando conecta). */
  async statusNumber(tenantId: string | undefined, instanceId: string) {
    if (!tenantId) return { state: 'none' as const };
    const inst = await this.assertInstance(tenantId, instanceId);
    let state = 'close';
    try {
      const st: any = await this.whatsapp.getConnectionStatus(inst.name);
      state = st?.instance?.state ?? st?.state ?? 'close';
    } catch {
      state = 'close';
    }
    if (state !== 'open') return { state, instanceName: inst.name, number: inst.number ?? null };
    return this.finalizeNumber(tenantId, inst);
  }

  /** Desconecta (logout) um número e zera o número salvo. */
  async disconnectNumber(tenantId: string | undefined, instanceId: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const inst = await this.assertInstance(tenantId, instanceId);
    await this.whatsapp.logoutInstance(inst.name).catch(() => {});
    await (this.prisma as any).instance.update({ where: { id: inst.id }, data: { number: null } }).catch(() => {});
    return { ok: true };
  }

  /** Exclui um número (logout + delete na Evolution + remove o registro). Mantém o departamento. */
  async deleteNumber(tenantId: string | undefined, instanceId: string) {
    if (!tenantId) throw new BadRequestException('Tenant não identificado.');
    const inst = await this.assertInstance(tenantId, instanceId);
    await this.whatsapp.logoutInstance(inst.name).catch(() => {});
    await this.whatsapp
      .deleteInstance(inst.name)
      .catch((e: any) => this.logger.warn(`deleteInstance(${inst.name}) falhou: ${e?.message ?? e}`));
    await (this.prisma as any).instance.delete({ where: { id: inst.id } });
    return { ok: true };
  }
}
