import { IsString, IsOptional, IsEmail, IsArray, IsIn } from 'class-validator';

const VALID_STAGES = ['NOVO', 'QUALIFICADO', 'EM_ATENDIMENTO', 'FINALIZADO', 'PERDIDO'];

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
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateLeadStageDto {
  @IsString()
  @IsIn(VALID_STAGES, { message: `Stage deve ser um de: ${VALID_STAGES.join(', ')}` })
  stage: string;
}
