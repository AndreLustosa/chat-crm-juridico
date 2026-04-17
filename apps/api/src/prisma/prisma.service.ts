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

        // Log explícito de QUAL banco foi conectado + contagem básica.
        // Protege contra bug onde DATABASE_URL aponta para banco errado/vazio:
        // se os counts forem ~0 mas o sistema deveria ter dados, fica óbvio no log.
        this.logDatabaseIdentity().catch(e => this.logger.warn(`[DB-Identity] Falha ao logar identidade: ${e.message}`));
      } catch (err) {
        this.logger.error(
          `❌ Erro na tentativa ${attempts}: ${err.message}. Nova tentativa em 5 segundos...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Loga o hostname/database do DATABASE_URL + contagens de tabelas principais.
   * Defesa contra bug de configuração onde a API conecta num banco vazio/errado
   * e não há sintoma óbvio nos logs até o frontend mostrar "nenhuma conversa".
   */
  private async logDatabaseIdentity() {
    // Extrai host e database do DATABASE_URL (sem expor credenciais no log)
    const url = process.env.DATABASE_URL || '';
    const match = url.match(/^(postgres(?:ql)?):\/\/[^@]*@([^/:]+)(?::(\d+))?\/([^?]+)/);
    const host = match?.[2] || '???';
    const port = match?.[3] || '5432';
    const database = match?.[4] || '???';

    // Count rápido das tabelas principais — se todas vierem 0, é quase certo
    // que o banco está errado ou vazio.
    try {
      const [users, conversations, messages] = await Promise.all([
        (this as any).user.count(),
        (this as any).conversation.count(),
        (this as any).message.count(),
      ]);
      this.logger.log(
        `[DB-Identity] conectado em "${database}" @ ${host}:${port} — users=${users}, conversations=${conversations}, messages=${messages}`,
      );
      if (users === 0 && conversations === 0 && messages === 0) {
        this.logger.warn(
          `[DB-Identity] ⚠️  TODAS as tabelas principais estão vazias. Banco "${database}" pode ser o banco errado! Verifique DATABASE_URL.`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`[DB-Identity] conectado em "${database}" @ ${host}:${port} — count falhou: ${e.message}`);
    }
  }
}
