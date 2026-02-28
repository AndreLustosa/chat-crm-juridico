import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('instances')
  async listInstances() {
    return this.whatsappService.listInstances();
  }

  @Post('instances')
  async createInstance(@Body('name') name: string) {
    return this.whatsappService.createInstance(name);
  }

  @Delete('instances/:name')
  async deleteInstance(@Param('name') name: string) {
    return this.whatsappService.deleteInstance(name);
  }

  @Post('instances/:name/logout')
  async logoutInstance(@Param('name') name: string) {
    return this.whatsappService.logoutInstance(name);
  }

  @Get('instances/:name/connect')
  async getConnectCode(@Param('name') name: string) {
    return this.whatsappService.getConnectCode(name);
  }

  @Get('instances/:name/status')
  async getConnectionStatus(@Param('name') name: string) {
    return this.whatsappService.getConnectionStatus(name);
  }
}
