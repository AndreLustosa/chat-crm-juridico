import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@crm/shared';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit() {
    this.logger.log('Iniciando serviço de Banco de Dados. Aguardando conexão em background...');
    // Inicia conexão sem await para não travar o bootstrap
    void this.connectWithRetry();
  }

  private async connectWithRetry() {
    let connected = false;
    let attempts = 0;

    while (!connected) {
      try {
        attempts++;
        this.logger.log(`Tentativa ${attempts} de conectar ao Banco de Dados (VPS)...`);
        
        await this.$connect();
        
        connected = true;
        this.logger.log('✅ CONECTADO ao Banco de Dados (VPS) com sucesso!');
      } catch (err) {
        this.logger.error(
          `❌ Erro na tentativa ${attempts}: ${err.message}. Nova tentativa em 5 segundos...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}
