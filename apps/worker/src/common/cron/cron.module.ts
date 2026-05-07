import { Global, Module } from '@nestjs/common';
import { CronRunnerService } from './cron-runner.service';

@Global()
@Module({
  providers: [CronRunnerService],
  exports: [CronRunnerService],
})
export class CronModule {}
