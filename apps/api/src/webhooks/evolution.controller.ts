import { Controller, Post, Body, HttpCode, UseGuards, BadRequestException, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { EvolutionService } from './evolution.service';
import { HmacGuard } from './guards/hmac.guard';
import { Public } from '../auth/decorators/public.decorator';
import { EvolutionWebhookDto } from './dto/evolution-webhook.dto';

@Public()
@SkipThrottle()
@UseGuards(HmacGuard)
@Controller('webhooks/evolution')
export class EvolutionController {
  private readonly logger = new Logger(EvolutionController.name);

  /**
   * Allowlist de instancias DESTE escritorio (defesa em profundidade).
   *
   * Incidente 2026-05-25 (2a ocorrencia): mensagens do sistema Lexcon
   * (CRM Contabil — IA "Athena", alertas de MIT/ICMS) vazaram pro inbox
   * do Lustosa. O Evolution server eh COMPARTILHADO entre os 2 escritorios.
   *
   * O gate primario (cada handler -> inboxesService.findByInstanceName ->
   * rejeita se instancia nao cadastrada) ESTA correto e cobre os 10
   * handlers. Mas ele depende da tabela "Inbox" estar limpa: se uma
   * instancia do Lexcon for cadastrada como inbox do Lustosa (erro manual,
   * seed, restore), o gate passa e o vazamento volta.
   *
   * Esta allowlist eh uma PAREDE EXTERNA independente do banco: se
   * EVOLUTION_OWNED_INSTANCES estiver definida (CSV dos nomes de instancia
   * deste escritorio), qualquer webhook de instancia fora da lista eh
   * descartado ANTES de dispatch — mesmo que exista linha orfa em "Inbox".
   * Opt-in: env vazia = comportamento atual (so o gate do banco).
   *
   * Portainer: EVOLUTION_OWNED_INSTANCES=instancia1,instancia2
   */
  private readonly ownedInstances: Set<string> = new Set(
    (process.env.EVOLUTION_OWNED_INSTANCES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  constructor(private readonly evolutionService: EvolutionService) {}

  @Post()
  @HttpCode(200)
  // Param tipado como `any` (NAO `EvolutionWebhookDto`) — NestJS concatena
  // pipes (global + controller + param), entao um pipe local NAO sobrescreve
  // o global. Quando metatype eh `Object`, o ValidationPipe pula validacao
  // inteiramente — eh o unico jeito de aceitar campos extras com
  // forbidNonWhitelisted=true no global.
  //
  // Validacao do shape eh manual: hasInstance() + checagem do `event`
  // logo abaixo. DTO continua disponivel pra documentar o contrato — apenas
  // nao eh usado como metatype.
  //
  // Bug 2026-05-08: webhook 400 (mensagens nao chegavam no chat) apos
  // commit 448e025 trocar `any` por `EvolutionWebhookDto`. Memoria
  // feedback_nestjs_validationpipe_hierarchy.md.
  async handleWebhook(@Body() payload: any) {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('payload deve ser objeto');
    }
    if (!payload.event || typeof payload.event !== 'string') {
      throw new BadRequestException('event eh obrigatorio (string)');
    }
    if (!payload.data || typeof payload.data !== 'object') {
      throw new BadRequestException('data eh obrigatorio (objeto)');
    }
    if (!EvolutionWebhookDto.hasInstance(payload)) {
      throw new BadRequestException('instance ou instanceId eh obrigatorio');
    }
    const eventType = payload.event;

    // ─── Defesa em profundidade: allowlist por env (ver doc em ownedInstances) ───
    // Parede externa independente do banco. So aplica se a env estiver
    // configurada; caso contrario confia no gate do banco (findByInstanceName)
    // que cada handler ja executa. Retorna 200 (ack) pra Evolution nao
    // ficar reenviando — apenas NAO processa.
    if (this.ownedInstances.size > 0) {
      const instanceName = payload.instance || payload.instanceId;
      if (!instanceName || !this.ownedInstances.has(instanceName)) {
        this.logger.warn(
          `[WEBHOOK-REJECT] instancia "${instanceName ?? 'unknown'}" fora da allowlist ` +
          `EVOLUTION_OWNED_INSTANCES — descartado (defesa cross-tenant, evento=${eventType})`,
        );
        return { received: true, ignored: true };
      }
    }

    if (eventType === 'messages.upsert' || eventType === 'send.message') {
      // send.message = echo de mensagens enviadas pela API (IA, operador via Evolution)
      // Mesmo formato de payload que messages.upsert, com fromMe=true
      await this.evolutionService.handleMessagesUpsert(payload);
    } else if (eventType === 'messages.update') {
      await this.evolutionService.handleMessagesUpdate(payload);
    } else if (eventType === 'contacts.upsert') {
      await this.evolutionService.handleContactsUpsert(payload);
    } else if (eventType === 'chats.upsert' || eventType === 'chats.set') {
      await this.evolutionService.handleChatsUpsert(payload);
    } else if (eventType === 'chats.update') {
      await this.evolutionService.handleChatsUpsert(payload);
    } else if (eventType === 'chats.delete') {
      await this.evolutionService.handleChatsDelete(payload);
    } else if (eventType === 'messages.delete') {
      await this.evolutionService.handleMessagesDelete(payload);
    } else if (eventType === 'contacts.update') {
      await this.evolutionService.handleContactsUpdate(payload);
    } else if (eventType === 'connection.update') {
      await this.evolutionService.handleConnectionUpdate(payload);
    } else if (eventType === 'presence.update') {
      await this.evolutionService.handlePresenceUpdate(payload);
    }
    // Ack the webhook quickly
    return { received: true };
  }
}
