import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Início da assinatura SaaS (Fase 5 — Stripe). O escritório escolhe um plano.
 *
 * CPF/CNPJ e forma de pagamento são coletados no PRÓPRIO Checkout do Stripe
 * (tax_id_collection), então o backend NÃO recebe mais esses dados — exigir
 * cpfCnpj aqui fazia o ValidationPipe (whitelist + forbidNonWhitelisted)
 * rejeitar o checkout com 400 antes mesmo de chegar no Stripe.
 */
export class CheckoutDto {
  /** Código do plano (ver catálogo: P100, P100_IA, P200, P200_IA). */
  @IsString({ message: 'Plano é obrigatório' })
  planCode: string;

  /** Razão social / nome do responsável (opcional; não usado no fluxo Stripe). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
