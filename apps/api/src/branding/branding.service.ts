import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';

// Aceita só PNG (canal alfa/transparência) em data URL base64.
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/;
const MAX_BYTES = 900 * 1024; // ~900KB por imagem (PNG transparente otimizado)

@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Logo/icone do tenant (null quando nao personalizado → front usa o padrao). */
  async getForTenant(tenantId?: string): Promise<{ logo: string | null; icon: string | null }> {
    if (!tenantId) return { logo: null, icon: null };
    const b = await this.prisma.tenantBranding.findUnique({ where: { tenant_id: tenantId } });
    return { logo: b?.logo ?? null, icon: b?.icon ?? null };
  }

  /** Atualiza apenas os campos presentes. "" limpa o campo. Valida PNG + tamanho. */
  async update(tenantId: string | undefined, dto: UpdateBrandingDto) {
    if (!tenantId) throw new BadRequestException('Tenant nao identificado.');
    const data: { logo?: string | null; icon?: string | null } = {};
    if (dto.logo !== undefined) data.logo = this.normalize(dto.logo, 'logo');
    if (dto.icon !== undefined) data.icon = this.normalize(dto.icon, 'icone');
    if (Object.keys(data).length === 0) return this.getForTenant(tenantId);
    await this.prisma.tenantBranding.upsert({
      where: { tenant_id: tenantId },
      create: { tenant_id: tenantId, ...data },
      update: data,
    });
    return this.getForTenant(tenantId);
  }

  /** Valida o data URL; "" ou só espaço => null (limpa, volta ao padrao). */
  private normalize(value: string, label: string): string | null {
    const v = (value ?? '').trim();
    if (!v) return null;
    if (!PNG_DATA_URL.test(v)) {
      throw new BadRequestException(`A ${label} precisa ser um PNG (data URL image/png;base64).`);
    }
    const b64 = v.slice(v.indexOf(',') + 1).replace(/\s/g, '');
    const bytes = Math.floor((b64.length * 3) / 4);
    if (bytes > MAX_BYTES) {
      throw new BadRequestException(
        `A ${label} tem ~${Math.round(bytes / 1024)}KB; o limite e ${Math.round(MAX_BYTES / 1024)}KB. Otimize o PNG.`,
      );
    }
    return v;
  }
}
