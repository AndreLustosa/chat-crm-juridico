import { Global, Module } from '@nestjs/common';
import { CronRunnerService } from './cron-runner.service';

/**
 * Modulo global — CronRunnerService fica disponivel pra qualquer service.
 * Depende de PrismaModule (global) e LockModule (global), entao nao precisa
 * importar imports aqui.
 */
@Global()
@Module({
  providers: [CronRunnerService],
  exports: [CronRunnerService],
})
export class CronModule {}
