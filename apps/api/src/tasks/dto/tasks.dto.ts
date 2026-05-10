import { IsString, IsOptional, IsDateString, IsIn, IsUUID, MaxLength, ValidateIf } from 'class-validator';

// Bug fix 2026-05-10 (PR3 baixo #10): adicionar validators apropriados.
// Antes due_at e assigned_user_id em UpdateTaskDto so tinham @IsOptional —
// string lixo ("abc") passava direto pro new Date() = Invalid Date no DB.

export class CreateTaskDto {
  @IsString() @MaxLength(300)
  title: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsUUID()
  lead_id?: string;

  @IsOptional() @IsUUID()
  conversation_id?: string;

  @IsOptional() @IsUUID()
  legal_case_id?: string;

  @IsOptional() @IsUUID()
  assigned_user_id?: string;

  @IsOptional() @IsDateString()
  due_at?: string;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MaxLength(300)
  title?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsIn(['A_FAZER', 'EM_PROGRESSO', 'CONCLUIDA', 'CANCELADA'])
  status?: string;

  // due_at aceita string ISO ou null (pra remover prazo)
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString()
  due_at?: string | null;

  // assigned_user_id aceita UUID ou null (pra desatribuir)
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  assigned_user_id?: string | null;
}
