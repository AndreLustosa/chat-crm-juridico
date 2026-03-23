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
    @Body() body: { content_json?: any; content_html?: string; title?: string },
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

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.remove(id, req.user.tenant_id);
  }
}
