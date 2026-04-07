import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  Res,
  UseInterceptors,
  UploadedFile,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PetitionsService } from './petitions.service';
import { PetitionAiService } from './petition-ai.service';
import { PetitionChatService } from './petition-chat.service';
import type { ChatMessage, SkillRef, StreamChatParams } from './petition-chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('petitions')
export class PetitionsController {
  constructor(
    private readonly service: PetitionsService,
    private readonly aiService: PetitionAiService,
    private readonly chatService: PetitionChatService,
  ) {}

  // ─── Console Skills ────────────────────────────────────

  /** GET /petitions/chat/skills — list skills from Claude Console */
  @Get('chat/skills')
  getChatSkills(@Query('source') source?: 'all' | 'anthropic' | 'custom') {
    return this.chatService.listConsoleSkills(source || 'all');
  }

  /** GET /petitions/chat/skills/:id — get a specific skill */
  @Get('chat/skills/:id')
  getChatSkill(@Param('id') id: string) {
    return this.chatService.getConsoleSkill(id);
  }

  /** POST /petitions/chat/skills — create a custom skill via SKILL.md */
  @Post('chat/skills')
  createChatSkill(@Body() body: { displayTitle: string; skillMd: string }) {
    return this.chatService.createCustomSkill(body.displayTitle, body.skillMd);
  }

  /** DELETE /petitions/chat/skills/:id — delete a custom skill */
  @Delete('chat/skills/:id')
  deleteChatSkill(@Param('id') id: string) {
    return this.chatService.deleteCustomSkill(id);
  }

  // ─── Console Files ─────────────────────────────────────

  /** GET /petitions/chat/files — list files from Claude Console */
  @Get('chat/files')
  getChatFiles() {
    return this.chatService.listConsoleFiles();
  }

  /** POST /petitions/chat/files — upload file to Claude Console */
  @Post('chat/files')
  @UseInterceptors(FileInterceptor('file'))
  async uploadChatFile(@UploadedFile() file: any) {
    if (!file) throw new NotFoundException('Nenhum arquivo enviado');
    return this.chatService.uploadFileToConsole(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }

  /** GET /petitions/chat/files/:fileId/download — download file from Claude Console */
  @Get('chat/files/:fileId/download')
  async downloadChatFile(
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename, contentType } =
      await this.chatService.downloadFileFromConsole(fileId);

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  // ─── Chat Conversations (persisted in DB) ───────────────

  /** GET /petitions/chat/conversations — list user's chats */
  @Get('chat/conversations')
  listChats(@Request() req: any) {
    return this.chatService.listChats(req.user.id, req.user.tenant_id);
  }

  /** POST /petitions/chat/conversations — create new chat */
  @Post('chat/conversations')
  createChat(@Body() body: { model?: string }, @Request() req: any) {
    return this.chatService.createChat(
      req.user.id,
      req.user.tenant_id,
      body.model || 'claude-sonnet-4-6',
    );
  }

  /** GET /petitions/chat/conversations/:id — get chat with messages */
  @Get('chat/conversations/:id')
  async getChat(@Param('id') id: string, @Request() req: any) {
    const chat = await this.chatService.getChat(id, req.user.id);
    if (!chat) throw new NotFoundException('Conversa nao encontrada');
    return chat;
  }

  /** PATCH /petitions/chat/conversations/:id — update chat metadata */
  @Patch('chat/conversations/:id')
  updateChat(
    @Param('id') id: string,
    @Body() body: { title?: string; model?: string; container_id?: string },
    @Request() req: any,
  ) {
    return this.chatService.updateChat(id, req.user.id, body);
  }

  /** DELETE /petitions/chat/conversations/:id — delete chat */
  @Delete('chat/conversations/:id')
  deleteChat(@Param('id') id: string, @Request() req: any) {
    return this.chatService.deleteChat(id, req.user.id);
  }

  /** POST /petitions/chat/conversations/:id/messages — add message */
  @Post('chat/conversations/:id/messages')
  async addMessage(
    @Param('id') id: string,
    @Body() body: { role: 'user' | 'assistant'; content: string; files?: any },
  ) {
    return this.chatService.addMessage(id, body.role, body.content, body.files);
  }

  /** POST /petitions/chat/cleanup — cleanup old chats (admin only) */
  @Post('chat/cleanup')
  cleanup() {
    return this.chatService.cleanupOldChats();
  }

  // ─── Chat (Claude Streaming with Skills) ───────────────

  /** POST /petitions/chat — stream a Claude response (SSE) with Console skills */
  @Post('chat')
  async chat(
    @Body() body: any,
    @Res() res: Response,
  ) {
    return this.chatService.streamChat(body, res);
  }

  // ─── Case-scoped CRUD ─────────────────────────────────

  @Get('case/:caseId')
  findByCaseId(
    @Param('caseId') caseId: string,
    @Request() req: any,
  ) {
    return this.service.findByCaseId(caseId, req.user.tenant_id);
  }

  @Post('case/:caseId')
  create(
    @Param('caseId') caseId: string,
    @Body() body: {
      title: string;
      type: string;
      template_id?: string;
      content_json?: any;
      content_html?: string;
      create_google_doc?: boolean;
      deadline_at?: string;
    },
    @Request() req: any,
  ) {
    return this.service.create(caseId, body, req.user.id, req.user.tenant_id);
  }

  @Post('case/:caseId/generate')
  createAndGenerate(
    @Param('caseId') caseId: string,
    @Body() body: { title: string; type: string },
    @Request() req: any,
  ) {
    return this.aiService.createAndGenerate(caseId, body, req.user.id, req.user.tenant_id);
  }

  @Post(':id/generate')
  generate(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.aiService.generate(id, req.user.tenant_id);
  }

  @Get(':id')
  findById(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.findById(id, req.user.tenant_id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: {
      content_json?: any;
      content_html?: string;
      title?: string;
      deadline_at?: string;
      google_doc_url?: string;
      google_doc_id?: string;
    },
    @Request() req: any,
  ) {
    return this.service.update(id, body, req.user.tenant_id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Request() req: any,
  ) {
    return this.service.updateStatus(id, status, req.user.tenant_id);
  }

  @Post(':id/version')
  saveVersion(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.saveVersion(id, req.user.id, req.user.tenant_id);
  }

  @Get(':id/versions')
  findVersions(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.findVersions(id, req.user.tenant_id);
  }

  @Post(':id/review')
  review(
    @Param('id') id: string,
    @Body() body: { action: 'APROVAR' | 'DEVOLVER'; notes?: string },
    @Request() req: any,
  ) {
    return this.service.reviewPetition(id, body.action, body.notes, req.user.id, req.user.tenant_id);
  }

  // ─── Google Drive/Docs ─────────────────────────────────

  /** POST /petitions/:id/sync-gdoc — sincronizar conteúdo do Google Doc */
  @Post(':id/sync-gdoc')
  syncFromGoogleDoc(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.syncFromGoogleDoc(id, req.user.tenant_id);
  }

  /** GET /petitions/:id/export-pdf — exportar petição como PDF via Google Docs */
  @Get(':id/export-pdf')
  async exportPdf(
    @Param('id') id: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportPdf(id, req.user.tenant_id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.remove(id, req.user.tenant_id);
  }
}
