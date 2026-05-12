import { Logger } from '@nestjs/common';
import { signShareToken } from '@crm/shared';
import type { ToolHandler, ToolContext } from '../tool-executor';
import { requireTenant } from './tool-guards.util';

const PUBLIC_FOLDERS = ['CLIENTE', 'CONTRATOS', 'DECISOES', 'PROCURACOES'] as const;

const FOLDER_LABELS: Record<string, string> = {
  CLIENTE: 'Documento pessoal',
  CONTRATOS: 'Contrato',
  DECISOES: 'Decisão / Sentença',
  PROCURACOES: 'Procuração',
};

/**
 * Envia documento(s) do processo do cliente direto pelo WhatsApp.
 *
 * Quando usar (regra André, 2026-04-26):
 *   - Cliente pede sentenca, contrato, procuracao, decisao
 *   - Cliente pede "copia da sentenca", "documento X", "PDF da decisao"
 *   - Cliente pediu via portal mas IA quer entregar direto pra agilizar
 *
 * Como funciona:
 *   1. Lista CaseDocuments publicos do lead (folders DECISOES, CONTRATOS,
 *      PROCURACOES, CLIENTE) — internos (PROVAS, PETICOES) nunca aparecem
 *   2. Filtra por keyword (ex: "sentenca", "contrato") se passada
 *   3. Pra cada doc encontrado:
 *      - Gera URL publica temporaria (token assinado, TTL 7d)
 *      - Envia via Evolution sendMedia
 *   4. Retorna lista de documentos enviados pra IA mencionar na resposta
 *
 * Se nada for encontrado, retorna lista vazia + mensagem orientando IA a
 * pedir pro advogado subir o documento.
 */
export class EnviarDocumentoProcessoHandler implements ToolHandler {
  name = 'enviar_documento_processo';
  private readonly logger = new Logger(EnviarDocumentoProcessoHandler.name);

  async execute(
    params: { keyword?: string; case_number?: string },
    context: ToolContext,
  ): Promise<any> {
    // Bug fix 2026-05-11 (Skills PR1 #C7): tenant guard.
    // Antes: query CaseDocument filtrava so por lead_id+folder. Se contexto
    // corrompido (race entre workers, bug upstream), podia vazar documento
    // de outro tenant. Mesmo case_number pode existir em tenants diferentes
    // (numero CNJ eh global, nao tenant-scoped).
    const tenantId = requireTenant(context);
    const { prisma, whatsappService, leadId, leadPhone, instanceName } = context;

    if (!whatsappService) {
      return { success: false, error: 'WhatsApp service nao disponivel no contexto' };
    }

    const apiBase = process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL;
    if (!apiBase) {
      this.logger.warn('[enviar_documento] API_PUBLIC_URL nao configurada');
      return {
        success: false,
        error: 'Sistema de envio de documentos nao configurado. Pega o link do portal e oriente o cliente a baixar la.',
      };
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return { success: false, error: 'JWT_SECRET nao configurada' };
    }

    // Busca documentos publicos do lead. Filtra por case_number se passado.
    // Bug fix #C7: filtro tenant_id na relacao legal_case (defense-in-depth).
    const docs = await prisma.caseDocument.findMany({
      where: {
        folder: { in: PUBLIC_FOLDERS as unknown as string[] },
        legal_case: {
          lead_id: leadId,
          tenant_id: tenantId,
          archived: false,
          renounced: false,
          ...(params.case_number ? { case_number: params.case_number } : {}),
        },
      },
      select: {
        id: true,
        name: true,
        original_name: true,
        folder: true,
        mime_type: true,
        created_at: true,
        legal_case: { select: { case_number: true, action_type: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    if (docs.length === 0) {
      // ─── Fallback: tenta scraping do TJAL ───
      // Endpoint interno faz: CaseDocument lookup + scraper + S3 upload + auto-cria CaseDocument
      this.logger.log(`[enviar_documento] Cache vazio, tentando scraping TJAL pra keyword="${params.keyword || 'qualquer'}"`);
      const scraped = await this.tryFetchFromCourt(params.keyword || 'sentenca', params.case_number, leadId, tenantId);
      if (scraped) {
        // Conseguiu — manda via Evolution
        try {
          const result = await whatsappService.sendMedia(
            leadPhone,
            'document',
            scraped.share_url,
            `📎 ${scraped.name}`,
            instanceName || undefined,
            scraped.name,
          );
          if (result?.error || result?.statusCode >= 400) {
            this.logger.warn(`[enviar_documento] Sendmedia falhou pos-scrape: ${JSON.stringify(result)}`);
            return { success: false, error: 'Documento foi baixado do tribunal mas nao consegui enviar via WhatsApp' };
          }
          return {
            success: true,
            message:
              `Baixei o documento "${scraped.name}" diretamente do tribunal e enviei ao cliente via WhatsApp. ` +
              `Confirme o recebimento e mencione que ele tambem fica disponivel no portal.`,
            sent: [{ name: scraped.name, type: scraped.folder }],
            scraped_from_court: true,
          };
        } catch (e: any) {
          this.logger.error(`[enviar_documento] Erro ao enviar pos-scrape: ${e.message}`);
        }
      }

      return {
        success: false,
        message:
          'Nao encontrei documentos publicos disponiveis no processo do cliente, ' +
          'e tambem nao consegui baixar diretamente do tribunal (pode ser sigiloso ou ' +
          'ainda nao publicado). Diga ao cliente que o advogado vai providenciar e ' +
          'disponibilizar em breve, OU sugira agendar consulta usando book_appointment.',
        documents_found: 0,
      };
    }

    // Filtra por keyword se passada — case-insensitive, busca em name+folder
    let filtered = docs;
    if (params.keyword && params.keyword.trim()) {
      const kw = params.keyword.toLowerCase().trim();
      filtered = docs.filter((d: any) =>
        d.name.toLowerCase().includes(kw) ||
        d.folder.toLowerCase().includes(kw) ||
        FOLDER_LABELS[d.folder]?.toLowerCase().includes(kw),
      );
      if (filtered.length === 0) {
        // Sem match exato, mostra os disponiveis pra IA escolher na proxima rodada
        return {
          success: false,
          message: `Nao encontrei documento que case com "${params.keyword}". Documentos disponiveis no processo do cliente:`,
          available_documents: docs.map((d: any) => ({
            id: d.id,
            name: d.name,
            type: FOLDER_LABELS[d.folder] || d.folder,
            date: d.created_at.toISOString().slice(0, 10),
            case: d.legal_case.case_number,
          })),
        };
      }
    }

    // Limite de 5 docs por chamada pra evitar spam
    const toSend = filtered.slice(0, 5);
    const sent: Array<{ name: string; type: string }> = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const doc of toSend) {
      try {
        const token = signShareToken(
          { sub: doc.id, lead_id: leadId, aud: 'doc-share' },
          secret,
          7 * 24 * 60 * 60, // 7 dias
        );
        const url = `${apiBase}/portal/documents/share/${doc.id}?token=${encodeURIComponent(token)}`;
        const folderLabel = FOLDER_LABELS[doc.folder] || doc.folder;
        const caption = `📎 *${folderLabel}*\n${doc.name}`;

        const result = await whatsappService.sendMedia(
          leadPhone,
          'document',
          url,
          caption,
          instanceName || undefined,
          doc.original_name,
        );

        if (result?.error || result?.statusCode >= 400) {
          failed.push({ name: doc.name, error: `Evolution ${result?.statusCode}` });
          this.logger.warn(`[enviar_documento] Falha em ${doc.id}: ${JSON.stringify(result)}`);
        } else {
          sent.push({ name: doc.name, type: folderLabel });
          this.logger.log(`[enviar_documento] Doc ${doc.id} (${doc.name}) enviado pra ${leadPhone}`);
        }
      } catch (e: any) {
        failed.push({ name: doc.name, error: e.message });
        this.logger.error(`[enviar_documento] Erro em ${doc.id}: ${e.message}`);
      }
    }

    if (sent.length === 0) {
      return {
        success: false,
        message: 'Tentei enviar mas nao consegui. Diga ao cliente que vai receber em breve por outra via.',
        failed,
      };
    }

    return {
      success: true,
      message:
        `Enviei ${sent.length} documento(s) ao cliente via WhatsApp. ` +
        `Confirme o recebimento na resposta e diga que eles tambem ficam disponiveis no portal.`,
      sent,
      failed: failed.length > 0 ? failed : undefined,
      total_available: docs.length,
    };
  }

  /**
   * Tenta baixar documento direto do TJAL via endpoint interno da API.
   * Endpoint usa scraper + auto-cadastra como CaseDocument folder=DECISOES.
   * So funciona pra TJAL e documentos publicos.
   */
  private async tryFetchFromCourt(
    keyword: string,
    caseNumber: string | undefined,
    leadId: string,
    tenantId: string,
  ): Promise<{ id: string; name: string; folder: string; share_url: string } | null> {
    const apiBase = process.env.API_INTERNAL_URL ||
      process.env.API_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_API_URL;
    const secret = process.env.INTERNAL_API_SECRET;

    if (!apiBase || !secret) {
      this.logger.warn(
        '[enviar_documento] API_INTERNAL_URL ou INTERNAL_API_SECRET nao configurada — fallback de scraping desabilitado',
      );
      return null;
    }

    try {
      const res = await fetch(`${apiBase}/portal/documents/internal/find-or-fetch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify({ lead_id: leadId, tenant_id: tenantId, keyword, case_number: caseNumber }),
        signal: AbortSignal.timeout(60000), // scraping pode demorar
      });
      if (res.status === 404) {
        this.logger.log(`[enviar_documento] Tribunal: nao encontrou doc pra keyword="${keyword}"`);
        return null;
      }
      if (!res.ok) {
        this.logger.warn(`[enviar_documento] HTTP ${res.status} no fetch interno`);
        return null;
      }
      const data = await res.json();
      this.logger.log(`[enviar_documento] Doc obtido via ${data.source}: ${data.name}`);
      return data;
    } catch (e: any) {
      this.logger.error(`[enviar_documento] Erro no fetch interno: ${e.message}`);
      return null;
    }
  }
}
