import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
}
