/**
 * Resolução do efetivo de notificação "task_overdue" (3 canais).
 *
 * Modelo tri-state:
 *   - override do atendente (NotificationSetting.preferences.taskOverdueOverride):
 *       boolean → vale; null/ausente → herda do escritório.
 *   - padrão do escritório (Tenant.notification_defaults.taskOverdue):
 *       boolean → vale; ausente → fallback true.
 *
 * Efetivo por canal: override[ch] se boolean, senão officeDefault[ch] se boolean,
 * senão true.
 *
 * Função PURA e sem dependências — duplicada (idêntica) em apps/worker para
 * evitar acoplar o typecheck do worker ao rebuild do @crm/shared/dist.
 */

export interface OverdueOverride {
  whatsapp?: boolean | null;
  badge?: boolean | null;
  sound?: boolean | null;
}

export interface OverdueOfficeDefault {
  whatsapp?: boolean | null;
  badge?: boolean | null;
  sound?: boolean | null;
}

export interface OverdueEffective {
  whatsapp: boolean;
  badge: boolean;
  sound: boolean;
}

const CHANNELS = ['whatsapp', 'badge', 'sound'] as const;

/** Resolve um único canal: override booleano vence; senão office booleano; senão true. */
function resolveChannel(
  overrideVal: boolean | null | undefined,
  officeVal: boolean | null | undefined,
): boolean {
  if (typeof overrideVal === 'boolean') return overrideVal;
  if (typeof officeVal === 'boolean') return officeVal;
  return true;
}

/**
 * Retorna o efetivo {whatsapp, badge, sound} combinando override do atendente
 * com o padrão do escritório. Tolera null/undefined nos dois argumentos.
 */
export function resolveOverdueEffective(
  override: OverdueOverride | null | undefined,
  officeDefault: OverdueOfficeDefault | null | undefined,
): OverdueEffective {
  const ov = override || {};
  const off = officeDefault || {};
  const out = {} as OverdueEffective;
  for (const ch of CHANNELS) {
    out[ch] = resolveChannel(ov[ch], off[ch]);
  }
  return out;
}
