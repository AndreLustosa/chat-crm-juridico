import type { ToolHandler } from '../tool-executor';
import { EscalateToHumanHandler } from './escalate-to-human';
import { UpdateLeadHandler } from './update-lead';
import { SaveFormFieldHandler } from './save-form-field';
import { WebhookHandler } from './webhook-handler';
import { BookAppointmentHandler } from './book-appointment';
import { CheckAvailabilityHandler } from './check-availability';
import { SearchReferencesHandler } from './search-references';
import { SearchMemoryHandler } from './search-memory';
import { GetCaseMovementsHandler } from './get-case-movements';
import { GetLeadInfoHandler } from './get-lead-info';
import { AbrirCasoViabilidadeHandler } from './abrir-caso-viabilidade';
import { SendPortalLinkHandler } from './send-portal-link';
import { EnviarDocumentoProcessoHandler } from './enviar-documento-processo';

/**
 * Registry central de tool handlers built-in.
 * Mapeia nome do handler → instância.
 */

// Handlers built-in disponíveis
const BUILTIN_HANDLERS: ToolHandler[] = [
  new EscalateToHumanHandler(),
  new UpdateLeadHandler(),
  new SaveFormFieldHandler(),
  new BookAppointmentHandler(),
  new CheckAvailabilityHandler(),
  new SearchReferencesHandler(),
  new SearchMemoryHandler(),
  new GetCaseMovementsHandler(),
  new GetLeadInfoHandler(),
  new AbrirCasoViabilidadeHandler(),
  new SendPortalLinkHandler(),
  new EnviarDocumentoProcessoHandler(),
];

/**
 * Tools UNIVERSAIS — sempre disponiveis em TODA skill que usa tool calling,
 * independente de estarem registradas como SkillTool no banco.
 *
 * Adicionadas em 2026-04-21: pivot da arquitetura de pre-consolidacao (LLM
 * gerava LeadProfile.summary a cada movimentacao nova) para on-demand
 * (IA busca info do lead/processo no banco via tool call). Garante que
 * qualquer skill, mesmo as mais minimalistas, consegue responder sobre
 * processo e cliente sem depender de consolidacao previa.
 */
const UNIVERSAL_TOOLS: Set<string> = new Set([
  'get_case_movements',
  'get_lead_info',
  'search_memory', // ja existia, elevado a universal
  'abrir_caso_viabilidade', // so chamada quando lead.is_client=true (handler valida)
  'book_appointment', // agenda consulta direto via IA quando cliente prefere
  'send_portal_link', // oferece self-service quando cliente quer agendar sozinho
  'enviar_documento_processo', // envia sentenca/contrato/procuracao/decisao via WhatsApp
]);

/**
 * Cria um Map<nome, handler> a partir das SkillTools de uma skill.
 * Para tools builtin, usa o handler do registry.
 * Para tools webhook, cria um WebhookHandler com a config.
 *
 * Tools UNIVERSAIS sao automaticamente injetadas mesmo se a skill nao
 * tiver SkillTool correspondente no banco.
 */
export function buildHandlerMap(skillTools: any[]): Map<string, ToolHandler> {
  const map = new Map<string, ToolHandler>();

  // Index builtin handlers
  const builtinIndex = new Map<string, ToolHandler>();
  for (const h of BUILTIN_HANDLERS) {
    builtinIndex.set(h.name, h);
  }

  // Sempre injetar tools universais primeiro
  for (const name of UNIVERSAL_TOOLS) {
    const handler = builtinIndex.get(name);
    if (handler) map.set(name, handler);
  }

  for (const tool of skillTools) {
    if (!tool.active) continue;

    if (tool.handler_type === 'builtin') {
      const builtinName = tool.handler_config?.builtin || tool.name;
      const handler = builtinIndex.get(builtinName);
      if (handler) {
        map.set(tool.name, handler);
      }
    } else if (tool.handler_type === 'webhook') {
      map.set(tool.name, new WebhookHandler(tool.name, tool.handler_config));
    }
  }

  return map;
}

export { BUILTIN_HANDLERS, UNIVERSAL_TOOLS };
