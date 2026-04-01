import { Controller, Post, Body, HttpCode, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { EvolutionService } from './evolution.service';
import { HmacGuard } from './guards/hmac.guard';
import { Public } from '../auth/decorators/public.decorator';

@Public()
@SkipThrottle()
@UseGuards(HmacGuard)
@Controller('webhooks/evolution')
export class EvolutionController {
  constructor(private readonly evolutionService: EvolutionService) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() payload: any) {
    // Basic support for different event types
    const eventType = payload.event as string;

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
