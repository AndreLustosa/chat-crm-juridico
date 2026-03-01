import { Controller, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { EvolutionService } from './evolution.service';

@Controller('webhooks/evolution')
export class EvolutionController {
  constructor(private readonly evolutionService: EvolutionService) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() payload: any) {
    // Basic support for different event types
    const eventType = payload.event as string;
    
    if (eventType === 'messages.upsert') {
      await this.evolutionService.handleMessagesUpsert(payload);
    } else if (eventType === 'messages.update') {
      await this.evolutionService.handleMessagesUpdate(payload);
    } else if (eventType === 'contacts.upsert') {
      await this.evolutionService.handleContactsUpsert(payload);
    } else if (eventType === 'chats.upsert' || eventType === 'chats.set') {
      await this.evolutionService.handleChatsUpsert(payload);
    }
    // Ack the webhook quickly
    return { received: true };
  }
}
