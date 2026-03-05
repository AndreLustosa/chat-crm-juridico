import { Module } from '@nestjs/common';
import { DjenService } from './djen.service';
import { DjenController } from './djen.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [DjenController],
  providers: [DjenService],
  exports: [DjenService],
})
export class DjenModule {}
