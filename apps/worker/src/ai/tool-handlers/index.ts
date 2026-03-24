import type { ToolHandler } from '../tool-executor';
import { EscalateToHumanHandler } from './escalate-to-human';
import { UpdateLeadHandler } from './update-lead';
import { SaveFormFieldHandler } from './save-form-field';
import { WebhookHandler } from './webhook-handler';
import { BookAppointmentHandler } from './book-appointment';
import { CheckAvailabilityHandler } from './check-availability';
import { SearchReferencesHandler } from './search-references';

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
];

/**
 * Cria um Map<nome, handler> a partir das SkillTools de uma skill.
 * Para tools builtin, usa o handler do registry.
 * Para tools webhook, cria um WebhookHandler com a config.
 */
export function buildHandlerMap(skillTools: any[]): Map<string, ToolHandler> {
  const map = new Map<string, ToolHandler>();

  // Index builtin handlers
  const builtinIndex = new Map<string, ToolHandler>();
  for (const h of BUILTIN_HANDLERS) {
    builtinIndex.set(h.name, h);
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

export { BUILTIN_HANDLERS };
