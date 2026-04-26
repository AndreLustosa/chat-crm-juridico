import { Logger } from '@nestjs/common';
import { signShareToken } from '@crm/shared';
import type { ToolHandler, ToolContext } from '../tool-executor';

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
    const docs = await prisma.caseDocument.findMany({
      where: {
        folder: { in: PUBLIC_FOLDERS as unknown as string[] },
        legal_case: {
          lead_id: leadId,
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
      return {
        success: false,
        message:
          'Nao encontrei documentos publicos disponiveis no processo do cliente. ' +
          'Os documentos podem ainda nao ter sido enviados pelo advogado. ' +
          'Diga ao cliente que o advogado vai providenciar e disponibilizar em breve, ' +
          'OU sugira agendar consulta usando book_appointment.',
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
}
