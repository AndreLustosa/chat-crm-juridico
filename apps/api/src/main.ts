import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Carregar .env da raiz do projeto antes de qualquer coisa
const possiblePaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../../../.env'),
];

for (const envPath of possiblePaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[Bootstrap] Configuração carregada de: ${envPath}`);
    break;
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = process.env.PORT ?? 3005;
  const dbUrl = process.env.DATABASE_URL;

  logger.log('Iniciando Bootstrap...');
  logger.log(`DATABASE_URL carregada: ${dbUrl ? 'SIM (inicia com ' + dbUrl.substring(0, 20) + '...)' : 'NAO'}`);

  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  await app.listen(port, '0.0.0.0');
  logger.log(`API rodando em http://localhost:${port}`);
}
void bootstrap();
