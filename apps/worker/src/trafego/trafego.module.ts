import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { TrafegoSyncService } from './trafego-sync.service';
import { TrafegoCryptoService } from './trafego-crypto.service';
import { TrafegoConfigService } from './trafego-config.service';
import { GoogleAdsClientService } from './google-ads-client.service';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'trafego-sync' }),
  ],
  providers: [
    TrafegoCryptoService,
    TrafegoConfigService,
    GoogleAdsClientService,
    TrafegoSyncService,
  ],
})
export class TrafegoModule {}
