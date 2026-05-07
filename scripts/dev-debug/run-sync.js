const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/apps/api/src/app.module');
const { WhatsappService } = require('./dist/apps/api/src/whatsapp/whatsapp.service');

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const whatsappService = app.get(WhatsappService);
  
  console.log('Starting manual sync...');
  const result = await whatsappService.syncContacts('whatsapp', '00000000-0000-0000-0000-000000000000');
  console.log('Sync Result:', JSON.stringify(result, null, 2));
  
  await app.close();
}

run().catch(console.error);
