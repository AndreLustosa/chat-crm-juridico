import { Global, Module } from '@nestjs/common';
import { LockService } from './lock.service';

/**
 * Modulo global — LockService fica disponivel pra qualquer service do worker
 * sem precisar importar em cada module.
 */
@Global()
@Module({
  providers: [LockService],
  exports: [LockService],
})
export class LockModule {}
