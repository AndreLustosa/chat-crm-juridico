import { Controller, Get, Post, Delete, Param, Body, Request, UseGuards, BadRequestException } from '@nestjs/common';
import { LeadNotesService } from './lead-notes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsString, MinLength, MaxLength } from 'class-validator';

class CreateNoteDto {
  @IsString()
  @MinLength(1, { message: 'Nota não pode ser vazia' })
  @MaxLength(2000, { message: 'Nota muito longa (máx. 2000 caracteres)' })
  text: string;
}

@UseGuards(JwtAuthGuard)
@Controller('leads/:leadId/notes')
export class LeadNotesController {
  constructor(private readonly leadNotesService: LeadNotesService) {}

  @Get()
  findAll(@Param('leadId') leadId: string) {
    return this.leadNotesService.findByLead(leadId);
  }

  @Post()
  create(
    @Param('leadId') leadId: string,
    @Body() body: CreateNoteDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Usuário não autenticado');
    return this.leadNotesService.create(leadId, userId, body.text);
  }

  @Delete(':noteId')
  delete(
    @Param('noteId') noteId: string,
    @Request() req: any,
  ) {
    return this.leadNotesService.delete(noteId, req.user?.id, req.user?.role);
  }
}
