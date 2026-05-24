import { Module } from '@nestjs/common';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';

/**
 * Dados do escritório (tenant): identidade (nome/CNPJ/telefone), dono, plano e
 * tamanho da equipe. PrismaService é global; o RolesGuard global cobre o
 * @Roles('ADMIN') do PUT e o JwtAuthGuard global autentica o GET.
 */
@Module({
  controllers: [OfficeController],
  providers: [OfficeService],
})
export class OfficeModule {}
