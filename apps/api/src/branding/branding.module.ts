import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

/**
 * White-label por tenant: logo e icone (data URL PNG base64) em TenantBranding.
 * PrismaService e global (PrismaModule @Global). O RolesGuard global cobre o
 * @Roles('ADMIN') do PUT; o JwtAuthGuard global autentica o GET.
 */
@Module({
  controllers: [BrandingController],
  providers: [BrandingService],
})
export class BrandingModule {}
