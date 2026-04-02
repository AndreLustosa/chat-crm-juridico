import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class CreateChargeDto {
  @IsString()
  @IsNotEmpty()
  honorarioPaymentId: string;

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
