import { Logger } from '@nestjs/common';
import type { ToolHandler, ToolContext } from '../tool-executor';

/**
 * Envia o link do portal do cliente via WhatsApp como mensagem complementar.
 *
 * Quando usar (regra de negocio André, 2026-04-26):
 *   - Cliente insiste em falar com advogado humano apos a IA tentar resolver
 *   - Cliente quer agendar mas prefere escolher horario sozinho
 *   - Cliente pergunta sobre algo que pode resolver no portal (documentos,
 *     pagamentos, status do processo)
 *
 * O link eh `${PORTAL_BASE_URL}/portal` — cliente entra digitando o telefone,
 * recebe codigo OTP, e ja acessa todos os recursos disponiveis.
 *
 * Diferenca da escalate_to_human:
 *   - escalate_to_human: desliga a IA, conversa fica pra atendente
 *   - send_portal_link: IA continua atendendo, mas oferece self-service
 */
export class SendPortalLinkHandler implements ToolHandler {
  name = 'send_portal_link';
  private readonly logger = new Logger(SendPortalLinkHandler.name);

  async execute(
    params: { reason?: string },
    context: ToolContext,
  ): Promise<any> {
    const portalBase = process.env.PORTAL_BASE_URL || 'https://andrelustosaadvogados.com.br';
    const portalUrl = `${portalBase}/portal`;

    return {
      success: true,
      portal_url: portalUrl,
      message:
        `Link do portal: ${portalUrl}\n\n` +
        `O cliente pode digitar o telefone, receber codigo de 4 digitos no WhatsApp ` +
        `e acessar processos, documentos, pagamentos, contratos e tambem agendar consulta. ` +
        `Inclua esse link na sua resposta ao cliente, junto com uma frase explicando ` +
        `que ele pode usar pra acessar tudo sobre o caso ou agendar consulta.`,
      reason: params.reason || 'cliente solicitou self-service',
    };
  }
}
