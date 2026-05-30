import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Config da IA do escritório (Jurisflow → Configurações > IA, só ADMIN).
 * A IA (skills + API) é GLOBAL; aqui o escritório define apenas as VARIÁVEIS
 * que preenchem os prompts: nome da IA + dados do escritório (white-label).
 * Campo ausente => não altera; "" => limpa (exceto name, que não pode ficar vazio).
 */
export class UpdateAiConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ai_assistant_name?: string; // nome da IA (ex.: "Sophia")

  @IsOptional()
  @IsString()
  @MaxLength(400)
  ai_tone?: string; // tom/persona/saudação

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string; // nome do escritório (mesmo campo de Configurações > Escritório)

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  oab?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  site?: string;
}
