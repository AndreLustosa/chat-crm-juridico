import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * White-label: logo (horizontal) e icone (quadrado) como data URL PNG base64.
 * - Campo ausente (undefined) => nao altera.
 * - String vazia ("")        => limpa (volta a marca padrao).
 * - MaxLength e o teto bruto; o service valida formato (image/png) e tamanho real.
 */
export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  logo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  icon?: string;
}
