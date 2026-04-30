import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { TrafegoSyncService } from './trafego-sync.service';
import { TrafegoCryptoService } from './trafego-crypto.service';
import { TrafegoConfigService } from './trafego-config.service';
import { GoogleAdsClientService } from './google-ads-client.service';
import { TrafegoAlertEvaluatorService } from './trafego-alert-evaluator.service';
import { TrafegoAlertNotifierService } from './trafego-alert-notifier.service';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    BullModule.registerQueue({ name: 'trafego-sync' }),
  ],
  providers: [
    TrafegoCryptoService,
    TrafegoConfigService,
    GoogleAdsClientService,
    TrafegoAlertEvaluatorService,
    TrafegoAlertNotifierService,
    TrafegoSyncService,
  ],
})
export class TrafegoModule {}
