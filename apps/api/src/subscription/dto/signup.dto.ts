import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Payload do cadastro público (SaaS Fase 1). Cria um escritório (Tenant) novo
 * + o usuário ADMIN dono, com 15 dias de trial.
 *
 * Validação reforçada (endpoint público, sem auth):
 *   - senha mínimo 8 (login legado aceita 4, mas conta nova exige mais).
 *   - limites de tamanho previnem payloads abusivos.
 *   - normalização de e-mail (trim/lowercase) é feita no service.
 */
export class SignupDto {
  /** Nome do escritório → Tenant.name */
  @IsString({ message: 'Nome do escritório é obrigatório' })
  @MinLength(2, { message: 'Nome do escritório muito curto' })
  @MaxLength(120, { message: 'Nome do escritório muito longo' })
  officeName: string;

  /** Nome do administrador (dono da conta) */
  @IsString({ message: 'Seu nome é obrigatório' })
  @MinLength(2, { message: 'Nome muito curto' })
  @MaxLength(120, { message: 'Nome muito longo' })
  name: string;

  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(180, { message: 'E-mail muito longo' })
  email: string;

  @IsString({ message: 'Senha é obrigatória' })
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  @MaxLength(128, { message: 'Senha muito longa' })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Telefone inválido' })
  phone?: string;

  /** CNPJ opcional do escritório (anti-abuso / faturamento futuro). */
  @IsOptional()
  @IsString()
  @MaxLength(18, { message: 'CNPJ inválido' })
  cnpj?: string;
}
