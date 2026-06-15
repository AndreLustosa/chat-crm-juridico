import { IsString, IsOptional, IsEmail, IsArray, IsIn } from 'class-validator';

const VALID_STAGES = [
  // Stages atuais do funil CRM (QUALIFICANDO e o ponto de entrada padrao)
  'QUALIFICANDO', 'AGUARDANDO_FORM', 'REUNIAO_AGENDADA',
  'AGUARDANDO_DOCS', 'AGUARDANDO_PROC', 'FINALIZADO', 'PERDIDO',
  // Legado (ainda podem existir no banco — aceitos em PATCH mas nao expostos
  // no funil; normalizeStage() no frontend os converte pra QUALIFICANDO).
  'NOVO', 'INICIAL', 'QUALIFICADO', 'EM_ATENDIMENTO', 'CONTATADO',
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

  // ─── Qualificação (procuração/contrato) — todos opcionais ───
  @IsOptional() @IsString() full_name?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() marital_status?: string;
  @IsOptional() @IsString() profession?: string;
  @IsOptional() @IsString() rg?: string;
  @IsOptional() @IsString() rg_issuer?: string;
  @IsOptional() @IsString() address_cep?: string;
  @IsOptional() @IsString() address_street?: string;
  @IsOptional() @IsString() address_number?: string;
  @IsOptional() @IsString() address_complement?: string;
  @IsOptional() @IsString() address_neighborhood?: string;
  @IsOptional() @IsString() address_city?: string;
  @IsOptional() @IsString() address_state?: string;
}

export class UpdateLeadStageDto {
  @IsString()
  @IsIn(VALID_STAGES, { message: `Stage deve ser um de: ${VALID_STAGES.join(', ')}` })
  stage: string;

  @IsOptional()
  @IsString()
  loss_reason?: string;
}

export class UpdateLeadPhoneDto {
  @IsString({ message: 'Telefone e obrigatorio' })
  phone: string;
}
