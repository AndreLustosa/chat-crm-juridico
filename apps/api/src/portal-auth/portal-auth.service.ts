import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { toCanonicalBrPhone, phoneVariants } from '../common/utils/phone';

/**
 * Auth do portal do cliente — passwordless via OTP no WhatsApp.
 *
 * Fluxo:
 *   1. requestCode(phone, ip): normaliza phone, busca Lead, gera codigo de 4
 *      digitos, envia via WhatsApp (mensagem clara). Idempotencia: se ja
 *      existe codigo valido < 60s, retorna o mesmo (rate limit).
 *   2. verifyCode(phone, code): busca codigo ativo + valida hash + checa
 *      expires_at + incrementa attempts. Se ok, marca used_at e emite JWT.
 *
 * Politica:
 *   - Resposta IDENTICA pra phone existente vs nao existente (anti-oracle)
 *   - Hash sha256(code) — NUNCA armazenar plaintext
 *   - TTL: 10min
 *   - Max attempts por codigo: 5 (depois invalida)
 *   - Rate limit: 1 codigo a cada 60s por lead
 *   - JWT audience='client' pra distinguir de tokens de advogado
 *   - JWT TTL 7 dias
 */
@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);
  private readonly CODE_TTL_MS = 10 * 60 * 1000;
  private readonly MAX_ATTEMPTS = 5;
  private readonly REQUEST_COOLDOWN_MS = 60 * 1000;
  private readonly JWT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 dias

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private whatsapp: WhatsappService,
  ) {}

  /**
   * Solicita codigo OTP. Resposta padronizada (anti-oracle): cliente nao
   * descobre se o telefone esta cadastrado ou nao.
   */
  async requestCode(rawPhone: string, ipAddress?: string): Promise<{ ok: true; cooldownSeconds: number }> {
    const canonical = toCanonicalBrPhone(rawPhone);
    if (!canonical) {
      throw new BadRequestException('Telefone invalido. Use formato (XX) XXXXX-XXXX.');
    }

    // Busca Lead por phone (tenta variantes pra cobrir backfill incompleto).
    const variants = phoneVariants(rawPhone);
    const lead = await this.prisma.lead.findFirst({
      where: { phone: { in: variants } },
      select: { id: true, name: true, phone: true, tenant_id: true },
    });

    // Anti-oracle: mesmo retorno pra "nao existe" ou "existe mas em cooldown".
    if (!lead) {
      this.logger.log(`[PORTAL-AUTH] Tentativa de codigo pra phone nao cadastrado: ${canonical.slice(-4)}`);
      // Simula trabalho pra timing attack ficar inviavel
      await new Promise(r => setTimeout(r, 300));
      return { ok: true, cooldownSeconds: 60 };
    }

    // Rate limit: ja gerou codigo nos ultimos 60s? Reusa.
    const recent = await this.prisma.clientLoginCode.findFirst({
      where: {
        lead_id: lead.id,
        used_at: null,
        created_at: { gte: new Date(Date.now() - this.REQUEST_COOLDOWN_MS) },
      },
      orderBy: { created_at: 'desc' },
    });
    if (recent) {
      this.logger.log(`[PORTAL-AUTH] Cooldown ativo pra lead ${lead.id} (cod ${recent.id} ainda valido)`);
      return { ok: true, cooldownSeconds: 60 };
    }

    // Gera codigo aleatorio 4 digitos (1000-9999, evita 0001 que parece bug)
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    await this.prisma.clientLoginCode.create({
      data: {
        lead_id: lead.id,
        code_hash: codeHash,
        expires_at: new Date(Date.now() + this.CODE_TTL_MS),
        ip_address: ipAddress,
      },
    });

    // Envia WhatsApp — mensagem clara, com aviso de seguranca
    const firstName = (lead.name || 'cliente').split(' ')[0];
    const message =
      `🔐 *Portal do Cliente*\n\n` +
      `Olá, ${firstName}! Seu código de acesso é:\n\n` +
      `*${code}*\n\n` +
      `Válido por 10 minutos. Se não foi você quem solicitou, ignore esta mensagem — nunca compartilhe esse código com ninguém.\n\n` +
      `🤖 _Esta é uma mensagem automática do sistema._\n` +
      `_André Lustosa Advogados_`;

    try {
      const instance = process.env.EVOLUTION_INSTANCE_NAME || 'whatsapp';
      await this.whatsapp.sendText(lead.phone, message, instance);
      this.logger.log(`[PORTAL-AUTH] Codigo enviado pra lead ${lead.id} (${canonical.slice(-4)})`);
    } catch (e: any) {
      this.logger.error(`[PORTAL-AUTH] Falha ao enviar WhatsApp pra ${lead.id}: ${e.message}`);
      // Continua retornando "ok" pra cliente — nao revela infraestrutura
    }

    return { ok: true, cooldownSeconds: 60 };
  }

  /**
   * Valida codigo. Retorna JWT se ok.
   */
  async verifyCode(rawPhone: string, code: string): Promise<{ access_token: string; lead: { id: string; name: string | null } }> {
    const canonical = toCanonicalBrPhone(rawPhone);
    if (!canonical || !/^\d{4}$/.test(code)) {
      throw new UnauthorizedException('Codigo invalido ou telefone mal formatado.');
    }

    const variants = phoneVariants(rawPhone);
    const lead = await this.prisma.lead.findFirst({
      where: { phone: { in: variants } },
      select: { id: true, name: true, tenant_id: true },
    });
    if (!lead) {
      // Mesma resposta de codigo errado — anti-enumeration
      throw new UnauthorizedException('Codigo invalido ou expirado.');
    }

    // Pega o codigo MAIS RECENTE ativo
    const stored = await this.prisma.clientLoginCode.findFirst({
      where: {
        lead_id: lead.id,
        used_at: null,
        expires_at: { gte: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!stored) {
      throw new UnauthorizedException('Codigo invalido ou expirado.');
    }

    if (stored.attempts >= this.MAX_ATTEMPTS) {
      this.logger.warn(`[PORTAL-AUTH] Codigo ${stored.id} invalidado por excesso de tentativas`);
      throw new UnauthorizedException('Muitas tentativas — solicite um novo codigo.');
    }

    // Hash + compare. Sempre incrementa attempts antes (mesmo em sucesso, pra
    // anular timing-attack baseado em latencia).
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const matches = crypto.timingSafeEqual(
      Buffer.from(codeHash, 'hex'),
      Buffer.from(stored.code_hash, 'hex'),
    );

    await this.prisma.clientLoginCode.update({
      where: { id: stored.id },
      data: { attempts: stored.attempts + 1 },
    });

    if (!matches) {
      this.logger.log(`[PORTAL-AUTH] Codigo errado pra lead ${lead.id} (tentativa ${stored.attempts + 1}/${this.MAX_ATTEMPTS})`);
      throw new UnauthorizedException('Codigo invalido ou expirado.');
    }

    // Marca como usado pra impedir replay
    await this.prisma.clientLoginCode.update({
      where: { id: stored.id },
      data: { used_at: new Date() },
    });

    // Emite JWT com audience='client' pra distinguir do JWT de advogado
    const access_token = this.jwt.sign(
      {
        sub: lead.id,
        aud: 'client',
        tenant_id: lead.tenant_id || null,
      },
      { expiresIn: this.JWT_TTL_SECONDS },
    );

    this.logger.log(`[PORTAL-AUTH] Login bem-sucedido pra lead ${lead.id}`);

    return {
      access_token,
      lead: { id: lead.id, name: lead.name },
    };
  }

  /**
   * Carrega dados do lead a partir do JWT (usado pelo guard).
   */
  async findLeadById(leadId: string) {
    return this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        tenant_id: true,
        is_client: true,
      },
    });
  }
}
