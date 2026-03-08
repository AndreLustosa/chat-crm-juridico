import { IsUUID, IsOptional, IsString, IsBoolean, IsIn } from 'class-validator';

export class CreateConversationDto {
  @IsUUID('4', { message: 'lead_id deve ser um UUID válido' })
  lead_id: string;

  @IsOptional()
  @IsString()
  @IsIn(['whatsapp', 'instagram', 'web'], { message: 'channel deve ser whatsapp, instagram ou web' })
  channel?: string;

  @IsOptional()
  @IsString()
  external_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'inbox_id deve ser um UUID válido' })
  inbox_id?: string;

  @IsOptional()
  @IsString()
  instance_name?: string;

  @IsOptional()
  @IsBoolean()
  ai_mode?: boolean;
}
