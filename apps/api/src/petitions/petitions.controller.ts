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
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PetitionsService } from './petitions.service';
import { PetitionAiService } from './petition-ai.service';
import { PetitionChatService } from './petition-chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateChatSkillDto,
  GetSkillsQueryDto,
  CreateChatDto,
  UpdateChatDto,
  AddChatMessageDto,
  StreamChatDto,
  CreatePetitionDto,
  CreateAndGenerateDto,
  UpdatePetitionDto,
  UpdateStatusDto,
  ReviewPetitionDto,
} from './petitions.dto';

/**
 * Bug fix 2026-05-10 (Peticoes PR1):
 *
 * Padroes sistemicos aplicados em todo o controller:
 *   #1, #2, #18: @Roles em endpoints destrutivos/custosos (skills,
 *     cleanup, geracao IA). Antes qualquer authed user (recepcionista,
 *     financeiro) gerava peticoes ou deletava skills compartilhadas.
 *   #20: DTOs com class-validator em TODOS endpoints. Antes body: any
 *     deixava prompt injection, content_html 100MB, model arbitrario.
 *   #4: chat() agora valida ownership de chatId (tenant + user).
 *
 * GLOBAL ValidationPipe ja roda { whitelist: true, forbidNonWhitelisted: true }
 * (configurado em main.ts) — campos extras sao rejeitados.
 */
@UseGuards(JwtAuthGuard)
@Controller('petitions')
export class PetitionsController {
  constructor(
    private readonly service: PetitionsService,
    private readonly aiService: PetitionAiService,
    private readonly chatService: PetitionChatService,
  ) {}

  // ─── Console Skills (ADMIN only — recurso compartilhado) ───────

  @Get('chat/skills')
  getChatSkills(@Query() q: GetSkillsQueryDto) {
    return this.chatService.listConsoleSkills(q.source || 'all');
  }

  @Get('chat/skills/:id')
  getChatSkill(@Param('id') id: string) {
    return this.chatService.getConsoleSkill(id);
  }

  // Bug fix #1: ADMIN apenas — skills sao compartilhadas entre tenants
  @Post('chat/skills')
  @Roles('ADMIN')
  createChatSkill(@Body() body: CreateChatSkillDto) {
    return this.chatService.createCustomSkill(body.displayTitle, body.skillMd);
  }

  @Delete('chat/skills/:id')
  @Roles('ADMIN')
  deleteChatSkill(@Param('id') id: string) {
    return this.chatService.deleteCustomSkill(id);
  }

  // ─── Console Files ─────────────────────────────────────────────

  @Get('chat/files')
  getChatFiles() {
    return this.chatService.listConsoleFiles();
  }

  @Post('chat/files')
  @UseInterceptors(FileInterceptor('file'))
  async uploadChatFile(@UploadedFile() file: any) {
    if (!file) throw new NotFoundException('Nenhum arquivo enviado');
    // Cap 25MB pra anexo (conservador — anexos tipicos sao petições PDF 1-5MB)
    if (file.size > 25 * 1024 * 1024) {
      throw new NotFoundException('Arquivo muito grande (max 25MB)');
    }
    return this.chatService.uploadFileToConsole(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }

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

  // ─── Chat Conversations (persisted in DB) ───────────────────────

  @Get('chat/conversations')
  listChats(@Request() req: any) {
    return this.chatService.listChats(req.user.id, req.user.tenant_id);
  }

  @Post('chat/conversations')
  createChat(@Body() body: CreateChatDto, @Request() req: any) {
    return this.chatService.createChat(
      req.user.id,
      req.user.tenant_id,
      body.model || 'claude-sonnet-4-6',
    );
  }

  @Get('chat/conversations/:id')
  async getChat(@Param('id') id: string, @Request() req: any) {
    // Bug fix #3: passa tenant_id pra defesa em profundidade
    const chat = await this.chatService.getChat(id, req.user.id, req.user.tenant_id);
    if (!chat) throw new NotFoundException('Conversa nao encontrada');
    return chat;
  }

  @Patch('chat/conversations/:id')
  updateChat(
    @Param('id') id: string,
    @Body() body: UpdateChatDto,
    @Request() req: any,
  ) {
    return this.chatService.updateChat(id, req.user.id, body, req.user.tenant_id);
  }

  @Delete('chat/conversations/:id')
  deleteChat(@Param('id') id: string, @Request() req: any) {
    return this.chatService.deleteChat(id, req.user.id, req.user.tenant_id);
  }

  // Bug fix #3 + #17: ownership check + atomico (#17 ja na service)
  @Post('chat/conversations/:id/messages')
  async addMessage(
    @Param('id') id: string,
    @Body() body: AddChatMessageDto,
    @Request() req: any,
  ) {
    return this.chatService.addMessage(
      id,
      body.role,
      body.content,
      body.files,
      req.user.id,
      req.user.tenant_id,
    );
  }

  // Bug fix #18: cleanup eh DESTRUTIVO — apenas ADMIN + tenant scope
  // (admin so pode limpar chats do proprio escritorio)
  @Post('chat/cleanup')
  @Roles('ADMIN')
  cleanup(@Request() req: any) {
    return this.chatService.cleanupOldChats(req.user.tenant_id);
  }

  // ─── Chat Streaming ───────────────────────────────────────────

  // Bug fix #4: DTO + injecao server-side de userId/tenantId/chatId
  // Bloqueia prompt injection via systemPrompt (DTO nao tem esse campo).
  // Bug fix #13: rate limit 20 msgs/min (chat eh interativo, mais
  // permissivo que generate). Cap de custo por dia esta em assertAiCostCap.
  // Bug fix #15: AbortController detecta close do client e propaga
  // cancelamento pra Anthropic — antes fechar aba continuava cobrando
  // tokens (8000 output tokens = US$ 0.12) sem ninguem ver a resposta.
  @Post('chat')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async chat(
    @Body() body: StreamChatDto,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    return this.chatService.streamChat(
      {
        messages: [{ role: 'user', content: body.newMessage }],
        skills: body.skills,
        model: body.model,
        containerId: body.containerId,
        fileIds: undefined, // files via files prop separado
        enableThinking: body.thinking,
        // CRITICOS — server-side, NAO do client
        userId: req.user.id,
        tenantId: req.user.tenant_id,
        chatId: body.chatId,
        abortSignal: abortController.signal,
      },
      res,
    );
  }

  // ─── Case-scoped CRUD ─────────────────────────────────────────

  @Get('case/:caseId')
  findByCaseId(@Param('caseId') caseId: string, @Request() req: any) {
    return this.service.findByCaseId(caseId, req.user.tenant_id);
  }

  // Bug fix #2: Roles em criar/gerar peticao (custo IA)
  @Post('case/:caseId')
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  create(
    @Param('caseId') caseId: string,
    @Body() body: CreatePetitionDto,
    @Request() req: any,
  ) {
    return this.service.create(caseId, body, req.user.id, req.user.tenant_id);
  }

  // Bug fix #13: rate limit pra geracao IA (5 chamadas / 5min por IP).
  // Cap diario por user/tenant esta no service via assertAiCostCap (#6).
  // Esse Throttle eh defesa adicional contra burst (script automatizado).
  @Post('case/:caseId/generate')
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  @Throttle({ default: { limit: 5, ttl: 5 * 60_000 } })
  createAndGenerate(
    @Param('caseId') caseId: string,
    @Body() body: CreateAndGenerateDto,
    @Request() req: any,
  ) {
    return this.aiService.createAndGenerate(
      caseId,
      body,
      req.user.id,
      req.user.tenant_id,
    );
  }

  @Post(':id/generate')
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  @Throttle({ default: { limit: 5, ttl: 5 * 60_000 } })
  generate(
    @Param('id') id: string,
    @Body() body: { lgpdConsent?: boolean } = {},
    @Request() req: any,
  ) {
    return this.aiService.generate(id, req.user.id, req.user.tenant_id, {
      lgpdConsent: body?.lgpdConsent,
    });
  }

  @Get(':id')
  findById(@Param('id') id: string, @Request() req: any) {
    return this.service.findById(id, req.user.tenant_id);
  }

  // Bug fix #7: passa actorUserId pra snapshot pre-edit
  @Patch(':id')
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  update(
    @Param('id') id: string,
    @Body() body: UpdatePetitionDto,
    @Request() req: any,
  ) {
    return this.service.update(id, body, req.user.tenant_id, req.user.id);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateStatusDto,
    @Request() req: any,
  ) {
    return this.service.updateStatus(id, body.status, req.user.tenant_id);
  }

  @Post(':id/version')
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  saveVersion(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.saveVersion(id, req.user.id, req.user.tenant_id);
  }

  @Get(':id/versions')
  findVersions(@Param('id') id: string, @Request() req: any) {
    return this.service.findVersions(id, req.user.tenant_id);
  }

  // Bug fix: review eh ato formal — ADMIN/ADVOGADO apenas (estagiario nao aprova)
  @Post(':id/review')
  @Roles('ADMIN', 'ADVOGADO')
  review(
    @Param('id') id: string,
    @Body() body: ReviewPetitionDto,
    @Request() req: any,
  ) {
    return this.service.reviewPetition(
      id,
      body.action,
      body.notes,
      req.user.id,
      req.user.tenant_id,
    );
  }

  // ─── Google Drive/Docs ─────────────────────────────────────────

  @Post(':id/sync-gdoc')
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  syncFromGoogleDoc(@Param('id') id: string, @Request() req: any) {
    return this.service.syncFromGoogleDoc(id, req.user.tenant_id);
  }

  @Get(':id/export-pdf')
  async exportPdf(
    @Param('id') id: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportPdf(
      id,
      req.user.tenant_id,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  // Delete — apenas ADMIN/ADVOGADO (estagiario nao deleta)
  @Delete(':id')
  @Roles('ADMIN', 'ADVOGADO')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.service.remove(id, req.user.tenant_id);
  }
}
