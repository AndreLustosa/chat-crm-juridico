import { Controller, Post, Body, HttpCode, UseGuards, BadRequestException } from '@nestjs/common';
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
