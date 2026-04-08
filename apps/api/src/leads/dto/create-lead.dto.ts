import { IsString, IsOptional, IsEmail, IsArray, IsIn } from 'class-validator';

const VALID_STAGES = [
  // Stages atuais do funil CRM
  'INICIAL', 'QUALIFICANDO', 'AGUARDANDO_FORM', 'REUNIAO_AGENDADA',
  'AGUARDANDO_DOCS', 'AGUARDANDO_PROC', 'FINALIZADO', 'PERDIDO',
  // Legado (ainda podem existir no banco)
  'NOVO', 'QUALIFICADO', 'EM_ATENDIMENTO',
];

export class CreateLeadDto {
  @IsString({ message: 'Nome e obrigatorio' })
  name: string;

  @IsString({ message: 'Telefone e obrigatorio' })
  phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email invalido' })
  email?: string;

  @IsOptional()
  @IsString()
  origin?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_STAGES)
  stage?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email invalido' })
  email?: string;

  @IsOptional()
  @IsString()
  cpf_cnpj?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateLeadStageDto {
  @IsString()
  @IsIn(VALID_STAGES, { message: `Stage deve ser um de: ${VALID_STAGES.join(', ')}` })
  stage: string;

  @IsOptional()
  @IsString()
  loss_reason?: string;
}
