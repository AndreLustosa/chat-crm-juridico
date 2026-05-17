// Patch do SDK google-ads-api PRECISA carregar antes de qualquer outra
// coisa que possa instanciar GoogleAdsServiceClient. Fixa bug do
// recursiveFieldMaskSearch que causava no-op silencioso em mutates de
// oneof fields (bidding strategy). Ver google-ads-sdk-patch.ts.
import './trafego/google-ads-sdk-patch';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
