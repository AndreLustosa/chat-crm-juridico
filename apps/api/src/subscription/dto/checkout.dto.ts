import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Início da assinatura SaaS (Fase 2a). O escritório escolhe um plano + informa CPF/CNPJ. */
export class CheckoutDto {
  /** Código do plano (ver catálogo: P100, P100_IA, P200, P200_IA). */
  @IsString({ message: 'Plano é obrigatório' })
  planCode: string;

  /** CPF (11) ou CNPJ (14) do escritório — exigido pelo Asaas para criar o customer. */
  @IsString({ message: 'CPF/CNPJ é obrigatório' })
  @MinLength(11, { message: 'CPF/CNPJ inválido' })
  @MaxLength(18, { message: 'CPF/CNPJ inválido' })
  cpfCnpj: string;

  /** Razão social / nome do responsável (opcional; default = nome do escritório). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
