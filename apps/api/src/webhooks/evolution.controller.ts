import { Controller, Post, Body, HttpCode, UseGuards, ValidationPipe, BadRequestException } from '@nestjs/common';
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
  async handleWebhook(
    // ValidationPipe NO PARAMETRO — prioridade maxima sobre o global.
    // Evolution envia muitos campos extras (destination, date_time, sender,
    // server_url, apikey, fromMe, etc) que variam por evento. Sem
    // forbidNonWhitelisted=false aqui, o pipe global (com forbid=true)
    // rejeitaria com 400 antes do controller-level pipe atuar.
    // Bug 2026-05-08: webhook 400 → mensagens nao chegavam no chat.
    @Body(new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidNonWhitelisted: false,
    })) payload: EvolutionWebhookDto,
  ) {
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
