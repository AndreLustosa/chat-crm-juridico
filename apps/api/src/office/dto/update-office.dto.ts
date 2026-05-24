import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Dados editáveis do escritório (menu Configurações > Escritório, só ADMIN).
 * Campo ausente => não altera; "" => limpa (exceto name, que não pode ficar vazio).
 */
export class UpdateOfficeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  cpf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}
