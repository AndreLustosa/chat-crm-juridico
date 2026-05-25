import { Module } from '@nestjs/common';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

/**
 * Permissoes granulares por tenant. PrismaService e global (PrismaModule @Global).
 * Exporta o service para o CapabilityGuard (registrado como APP_GUARD no AppModule)
 * conseguir injeta-lo. O RolesGuard global cobre o @Roles('ADMIN') do PUT.
 */
@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
