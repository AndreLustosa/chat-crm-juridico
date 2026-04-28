import { IsString, IsNotEmpty, IsIn, IsOptional, IsNumber, IsBoolean, ValidateNested, Min, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

/** Sub-DTOs pra juros/multa/desconto (modal multi-step Asaas-style) */
export class InterestDto {
  @IsNumber()
  @Min(0)
  value: number; // % ao mes
}

export class FineDto {
  @IsNumber()
  @Min(0)
  value: number;

  @IsOptional()
  @IsIn(['PERCENTAGE', 'FIXED'])
  type?: 'PERCENTAGE' | 'FIXED';
}

export class DiscountDto {
  @IsNumber()
  @Min(0)
  value: number;

  @IsInt()
  @Min(0)
  dueDateLimitDays: number; // 0 = ate o vencimento

  @IsOptional()
  @IsIn(['PERCENTAGE', 'FIXED'])
  type?: 'PERCENTAGE' | 'FIXED';
}

export class CreateChargeDto {
  @IsOptional()
  @IsString()
  honorarioPaymentId?: string;

  @IsOptional()
  @IsString()
  leadHonorarioPaymentId?: string;

  /**
   * UNDEFINED = cliente escolhe entre boleto/pix/cartao na tela do Asaas.
   * Os 3 outros valores fixam o tipo no momento da criacao.
   */
  @IsString()
  @IsNotEmpty()
  @IsIn(['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED'])
  billingType: string;

  /** Override do due_date salvo no HonorarioPayment. Formato: YYYY-MM-DD */
  @IsOptional()
  @IsString()
  dueDate?: string;

  /** Numero de parcelas (somente quando billingType = CREDIT_CARD ou UNDEFINED) */
  @IsOptional()
  @IsInt()
  @Min(1)
  installmentCount?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => InterestDto)
  interest?: InterestDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FineDto)
  fine?: FineDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto;

  /**
   * Repassa taxa do cartao (2.99% + R$ 0.49) ao cliente.
   * So aplica quando o billingType permite cartao.
   */
  @IsOptional()
  @IsBoolean()
  splitFees?: boolean;
}

export class CreateInstallmentChargeDto {
  @IsString()
  @IsNotEmpty()
  leadHonorarioId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['PIX', 'BOLETO', 'CREDIT_CARD'])
  billingType: string;
}

export class CreateBatchChargesDto {
  @IsString()
  @IsNotEmpty()
  honorarioId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['PIX', 'BOLETO', 'CREDIT_CARD'])
  billingType: string;
}
