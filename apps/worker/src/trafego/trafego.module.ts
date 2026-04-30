import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { TrafegoSyncService } from './trafego-sync.service';
import { TrafegoCryptoService } from './trafego-crypto.service';
import { TrafegoConfigService } from './trafego-config.service';
import { GoogleAdsClientService } from './google-ads-client.service';
import { GoogleAdsMutateService } from './google-ads-mutate.service';
import { TrafegoAlertEvaluatorService } from './trafego-alert-evaluator.service';
import { TrafegoAlertNotifierService } from './trafego-alert-notifier.service';
import { TrafegoMutateProcessor } from './trafego-mutate.processor';
import { TrafegoSyncExtendedService } from './trafego-sync-extended.service';
import { TrafficOCIService } from './trafego-oci.service';
import { TrafficOCIProcessor } from './trafego-oci.processor';
import { TrafficAIAgentService } from './traffic-ai-agent.service';
import { TrafficAIAgentCronService } from './traffic-ai-agent-cron.service';
import { TrafficAIAgentProcessor } from './traffic-ai-agent.processor';
import { TrafficCustomerMatchService } from './traffic-customer-match.service';
import { TrafficCustomerMatchProcessor } from './traffic-customer-match.processor';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    BullModule.registerQueue({ name: 'trafego-sync' }),
    BullModule.registerQueue({ name: 'trafego-mutate' }),
    BullModule.registerQueue({ name: 'trafego-oci' }),
    BullModule.registerQueue({ name: 'trafego-ai-agent' }),
    BullModule.registerQueue({ name: 'trafego-customer-match' }),
  ],
  providers: [
    TrafegoCryptoService,
    TrafegoConfigService,
    GoogleAdsClientService,
    GoogleAdsMutateService,
    TrafegoAlertEvaluatorService,
    TrafegoAlertNotifierService,
    TrafegoSyncService,
    TrafegoSyncExtendedService,
    TrafegoMutateProcessor,
    TrafficOCIService,
    TrafficOCIProcessor,
    TrafficAIAgentService,
    TrafficAIAgentCronService,
    TrafficAIAgentProcessor,
    TrafficCustomerMatchService,
    TrafficCustomerMatchProcessor,
  ],
  exports: [TrafficOCIService, TrafficAIAgentService, TrafficCustomerMatchService],
})
export class TrafegoModule {}
