import { Module, Global } from '@nestjs/common';
import { PushService } from './push.service';
import { PushController } from './push.controller';

@Global()
@Module({
  providers: [PushService],
  controllers: [PushController],
  exports: [PushService],
})
export class PushModule {}
