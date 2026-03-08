import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  title: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  lead_id?: string;

  @IsOptional() @IsString()
  conversation_id?: string;

  @IsOptional() @IsString()
  legal_case_id?: string;

  @IsOptional() @IsString()
  assigned_user_id?: string;

  @IsOptional() @IsDateString()
  due_at?: string;
}

export class UpdateTaskDto {
  @IsOptional() @IsString()
  title?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional()
  due_at?: string | null;

  @IsOptional() @IsString()
  assigned_user_id?: string | null;
}
