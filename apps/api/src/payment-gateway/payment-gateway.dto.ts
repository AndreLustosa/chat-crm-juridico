import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export class CreateChargeDto {
  @IsOptional()
  @IsString()
  honorarioPaymentId?: string;

  @IsOptional()
  @IsString()
  leadHonorarioPaymentId?: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['PIX', 'BOLETO', 'CREDIT_CARD'])
  billingType: string;
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
