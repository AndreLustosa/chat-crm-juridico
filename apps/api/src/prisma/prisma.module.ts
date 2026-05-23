import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { applyRlsExtension } from '../common/rls-prisma';
import { TENANT_RLS_ENABLED } from '../common/tenant-context';

// Flag OFF (default) → provider é a própria classe (comportamento atual, intacto).
// Flag ON → o provider entrega o client estendido com RLS (SET LOCAL app.tenant_id
// por request). O `base` mantém a lógica de conexão/retry; chamamos onModuleInit
// manualmente porque o Nest invocaria o hook no client estendido (que não o tem).
const prismaProvider = TENANT_RLS_ENABLED
  ? {
      provide: PrismaService,
      useFactory: () => {
        const base = new PrismaService();
        void base.onModuleInit();
        return applyRlsExtension(base);
      },
    }
  : PrismaService;

@Global()
@Module({
  providers: [prismaProvider],
  exports: [PrismaService],
})
export class PrismaModule {}
