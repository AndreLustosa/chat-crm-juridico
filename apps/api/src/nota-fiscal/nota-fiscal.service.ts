import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { tenantOrDefault } from '../common/constants/tenant';

@Injectable()
export class NotaFiscalService {
  private readonly logger = new Logger(NotaFiscalService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  // ─── List NFs ──────────────────────────────────────────

  async findAll(query: {
    tenantId?: string;
    leadId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (query.tenantId) where.tenant_id = query.tenantId;
    if (query.leadId) where.lead_id = query.leadId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.notaFiscal.findMany({
        where,
        include: {
          transaction: {
            select: {
              id: true,
              description: true,
              amount: true,
              status: true,
              category: true,
            },
          },
          lead: {
            select: { id: true, name: true, phone: true, email: true },
          },
        },
        orderBy: { created_at: 'desc' },
        take: query.limit || 50,
        skip: query.offset || 0,
      }),
      this.prisma.notaFiscal.count({ where }),
    ]);

    return { data, total };
  }

  // ─── Get single NF ────────────────────────────────────

  async findOne(id: string, tenantId?: string) {
    const nf = await this.prisma.notaFiscal.findUnique({
      where: { id },
      include: {
        transaction: {
          select: {
            id: true,
            description: true,
            amount: true,
            status: true,
            category: true,
            date: true,
            payment_method: true,
          },
        },
        lead: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    if (!nf) throw new NotFoundException('Nota fiscal nao encontrada');
    if (tenantId && nf.tenant_id && nf.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }

    return nf;
  }

  // ─── Emit NFS-e ───────────────────────────────────────

  async emit(transactionId: string, tenantId?: string) {
    // 1. Fetch transaction with lead data
    const transaction = await this.prisma.financialTransaction.findUnique({
      where: { id: transactionId },
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
          },
        },
      },
    });

    if (!transaction) throw new NotFoundException('Transacao financeira nao encontrada');
    if (tenantId && transaction.tenant_id && transaction.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a esta transacao');
    }

    // 2. Idempotent check — if NF already exists for this transaction, return it
    const existing = await this.prisma.notaFiscal.findUnique({
      where: { transaction_id: transactionId },
    });
    if (existing) {
      this.logger.warn(`NF ja existe para transacao ${transactionId}, retornando existente`);
      return existing;
    }

    // 3. Get NFS-e config from settings
    const [provider, apiKey, cnpj, inscricaoMunicipal, cnaeCode, issRate, servicoDescricao] =
      await Promise.all([
        this.settings.get('nfse_provider'),
        this.settings.get('nfse_api_key'),
        this.settings.get('nfse_cnpj'),
        this.settings.get('nfse_inscricao_municipal'),
        this.settings.get('nfse_cnae_code'),
        this.settings.get('nfse_default_iss_rate'),
        this.settings.get('nfse_servico_descricao'),
      ]);

    if (!provider || !apiKey) {
      throw new BadRequestException(
        'Configuracao de NFS-e incompleta. Configure provider e api_key nas configuracoes.',
      );
    }

    const resolvedCnae = cnaeCode || '6911-7/01';
    const resolvedIss = issRate || '5.00';
    const resolvedDescricao = servicoDescricao || 'Servicos advocaticios';

    const lead = (transaction as any).lead;
    const valor = Number(transaction.amount);
    const aliquotaIss = parseFloat(resolvedIss);
    const valorIss = Math.round(valor * (aliquotaIss / 100) * 100) / 100;

    // 4. Build NFS-e payload
    const payload = {
      prestador: {
        cnpj: cnpj,
        inscricao_municipal: inscricaoMunicipal,
      },
      tomador: {
        cpf_cnpj: lead?.cpf || null,
        razao_social: lead?.name || 'Consumidor Final',
        email: lead?.email || null,
      },
      servico: {
        codigo_cnae: resolvedCnae,
        descricao: resolvedDescricao,
        valor_servicos: valor,
        aliquota_iss: aliquotaIss,
        valor_iss: valorIss,
      },
    };

    // 5. Call provider API
    const providerResponse = await this.callProviderApi(
      provider.toUpperCase(),
      apiKey,
      payload,
    );

    // 6. Store result in NotaFiscal
    const nf = await this.prisma.notaFiscal.create({
      data: {
        tenant_id: tenantOrDefault(tenantId || transaction.tenant_id),
        transaction_id: transactionId,
        lead_id: transaction.lead_id || null,
        numero: providerResponse.numero || null,
        codigo_verificacao: providerResponse.codigo_verificacao || null,
        status: providerResponse.success ? 'EMITIDA' : 'ERRO',
        servico_codigo: resolvedCnae,
        servico_descricao: resolvedDescricao,
        valor: valor,
        aliquota_iss: aliquotaIss,
        valor_iss: valorIss,
        tomador_cpf_cnpj: lead?.cpf || null,
        tomador_nome: lead?.name || null,
        tomador_email: lead?.email || null,
        provider: provider.toUpperCase(),
        external_id: providerResponse.external_id || null,
        xml_url: providerResponse.xml_url || null,
        pdf_url: providerResponse.pdf_url || null,
        error_message: providerResponse.error_message || null,
        emitida_em: providerResponse.success ? new Date() : null,
      },
    });

    this.logger.log(`NF ${nf.id} criada para transacao ${transactionId} — status: ${nf.status}`);

    return nf;
  }

  // ─── Cancel NFS-e ─────────────────────────────────────

  async cancel(id: string, tenantId?: string) {
    const nf = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nf) throw new NotFoundException('Nota fiscal nao encontrada');
    if (tenantId && nf.tenant_id && nf.tenant_id !== tenantId) {
      throw new ForbiddenException('Acesso negado a este recurso');
    }
    if (nf.status === 'CANCELADA') {
      throw new ConflictException('Nota fiscal ja esta cancelada');
    }
    if (nf.status !== 'EMITIDA') {
      throw new BadRequestException('Somente notas emitidas podem ser canceladas');
    }

    // TODO: Call provider API to cancel the NFS-e on the provider side
    this.logger.warn(`Cancelamento de NF ${id} no provider ${nf.provider} — implementar integracao real`);

    return this.prisma.notaFiscal.update({
      where: { id },
      data: {
        status: 'CANCELADA',
        cancelada_em: new Date(),
      },
    });
  }

  // ─── Get NFS-e config status ──────────────────────────

  async getConfig(tenantId?: string) {
    const [provider, apiKey, cnpj, inscricaoMunicipal, cnaeCode, issRate, autoEmit, servicoDescricao] =
      await Promise.all([
        this.settings.get('nfse_provider'),
        this.settings.get('nfse_api_key'),
        this.settings.get('nfse_cnpj'),
        this.settings.get('nfse_inscricao_municipal'),
        this.settings.get('nfse_cnae_code'),
        this.settings.get('nfse_default_iss_rate'),
        this.settings.get('nfse_auto_emit'),
        this.settings.get('nfse_servico_descricao'),
      ]);

    return {
      configured: !!(provider && apiKey && cnpj),
      provider: provider || null,
      has_api_key: !!apiKey,
      cnpj: cnpj || null,
      inscricao_municipal: inscricaoMunicipal || null,
      cnae_code: cnaeCode || '6911-7/01',
      default_iss_rate: issRate || '5.00',
      auto_emit: autoEmit === 'true',
      servico_descricao: servicoDescricao || 'Servicos advocaticios',
    };
  }

  // ─── Auto-emit if enabled ─────────────────────────────

  async autoEmitIfEnabled(transactionId: string, tenantId?: string) {
    const autoEmit = await this.settings.get('nfse_auto_emit');
    if (autoEmit !== 'true') {
      this.logger.debug('Auto-emissao de NFS-e desabilitada, pulando');
      return null;
    }

    this.logger.log(`Auto-emissao habilitada, emitindo NF para transacao ${transactionId}`);
    return this.emit(transactionId, tenantId);
  }

  // ─── Provider API call (placeholder) ──────────────────

  /**
   * Bug fix 2026-05-10 (Honorarios PR3 #38 — CRITICO):
   *
   * ANTES (PERIGOSO): este metodo retornava `success: true` com numero
   * fake gerado de Date.now(). NotaFiscal entrava como "EMITIDA" no
   * banco, mensagens automaticas notificavam cliente "NF emitida com
   * numero NF12345678", mas a NF NAO EXISTE NA PREFEITURA. Crime
   * tributario por omissao de emissao + risco de cliente apresentar
   * NF "emitida" pelo CRM em pedido de credito → fraude documental.
   *
   * AGORA: lanca excecao explicita pra bloquear emissao falsa.
   * Para habilitar:
   *   1. Implementar uma das integrations reais (ENOTAS/NFEIO/FOCUSNFE)
   *   2. Setar NFE_PROVIDER_INTEGRATION_ENABLED=true no env (gate de
   *      seguranca explicito — nao basta a integration estar codada,
   *      precisa ativacao manual confirmando que conta foi configurada).
   *
   * TODO: integracao real com provider — payload base:
   *   - ENOTAS: POST https://api.enotas.com.br/v2/empresas/{cnpj}/nfes
   *     headers: Authorization Bearer apiKey
   *   - NFEIO: POST https://api.nfe.io/v1/companies/{id}/serviceinvoices
   *     headers: Authorization apiKey
   *   - FOCUSNFE: POST https://api.focusnfe.com.br/v2/nfse?ref=X
   *     headers: Authorization Token apiKey
   */
  private async callProviderApi(
    provider: string,
    apiKey: string,
    payload: any,
  ): Promise<{
    success: boolean;
    numero?: string;
    codigo_verificacao?: string;
    external_id?: string;
    xml_url?: string;
    pdf_url?: string;
    error_message?: string;
  }> {
    const integrationEnabled = process.env.NFE_PROVIDER_INTEGRATION_ENABLED === 'true';
    if (!integrationEnabled) {
      this.logger.error(
        `[NF-E] BLOQUEADO: Tentativa de emitir NFS-e via provider ${provider} mas integracao real ` +
        `NAO esta implementada nem ativada. Antes este metodo retornava numero MOCK fake — ` +
        `NF aparecia como EMITIDA mas nao existia na prefeitura (crime tributario). ` +
        `Pra habilitar: implementar integration real + setar NFE_PROVIDER_INTEGRATION_ENABLED=true.`,
      );
      throw new Error(
        'Emissao de NFS-e bloqueada: integracao com provider de NF-e nao foi implementada/ativada. ' +
        'Contate o suporte tecnico antes de tentar emitir notas fiscais.',
      );
    }

    // TODO: branch por provider quando integration real for codada
    throw new Error(
      `Emissao de NFS-e via ${provider} habilitada mas integration real nao foi codada ainda — abort.`,
    );
  }
}
