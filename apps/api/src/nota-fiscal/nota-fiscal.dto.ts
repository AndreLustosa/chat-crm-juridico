import { IsNotEmpty, IsString } from 'class-validator';

export class EmitNotaFiscalDto {
  @IsString()
  @IsNotEmpty()
  transactionId: string;
}
