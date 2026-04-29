import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TrafegoSyncService } from './trafego-sync.service';

@Module({
  imports: [PrismaModule],
  providers: [TrafegoSyncService],
})
export class TrafegoModule {}
