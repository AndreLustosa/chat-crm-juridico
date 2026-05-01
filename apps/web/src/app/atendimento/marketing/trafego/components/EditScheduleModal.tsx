'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, X, Clock, Plus, Trash2, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

type Day =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

const DAYS: { v: Day; label: string }[] = [
  { v: 'MONDAY', label: 'Seg' },
  { v: 'TUESDAY', label: 'Ter' },
  { v: 'WEDNESDAY', label: 'Qua' },
  { v: 'THURSDAY', label: 'Qui' },
  { v: 'FRIDAY', label: 'Sex' },
  { v: 'SATURDAY', label: 'Sáb' },
  { v: 'SUNDAY', label: 'Dom' },
];

const MINUTES = [0, 15, 30, 45] as const;

interface Slot {
  id: string; // ID local (uuid client-side) pra key do React
  day_of_week: Day;
  start_hour: number;
  start_minute: 0 | 15 | 30 | 45;
  end_hour: number;
  end_minute: 0 | 15 | 30 | 45;
  bid_modifier: number | null;
}

interface ServerSlot {
  id: string;
  google_criterion_id: string;
  day_of_week: Day;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  bid_modifier: number | null;
}

let slotIdCounter = 0;
function newSlotId(): string {
  slotIdCounter++;
  return `local-${Date.now()}-${slotIdCounter}`;
}

/**
 * Modal de edição do agendamento (ad_schedule). Substituição completa:
 * lista vazia = campanha 24/7. Aceita 0 a N slots, 1 por dia/horário.
 *
 * Validação client-side:
 *   - end > start no mesmo dia
 *   - bid_modifier entre 0.1 e 10.0 quando preenchido
 *   - sem sobreposição entre 2 slots no mesmo dia (warning visual,
 *     não bloqueia — Google aceita mas vira ambíguo)
 *
 * Presets:
 *   - "Horário comercial" → Seg-Sex 8-18
 *   - "Horário estendido" → Seg-Sex 7-22, Sáb 8-18
 *   - "24/7" → limpa tudo
 */
export function EditScheduleModal({
  open,
  campaignId,
  campaignName,
  initialSlots,
  onClose,
  onSaved,
}: {
  open: boolean;
  campaignId: string | null;
  campaignName: string;
  initialSlots: ServerSlot[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [validateOnly, setValidateOnly] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Hidrata quando abre
  useEffect(() => {
    if (!open) return;
    setSlots(
      initialSlots.map((s) => ({
        id: newSlotId(),
        day_of_week: s.day_of_week,
        start_hour: s.start_hour,
        start_minute: clampMinute(s.start_minute),
        end_hour: s.end_hour,
        end_minute: clampMinute(s.end_minute),
        bid_modifier: s.bid_modifier,
      })),
    );
    setValidateOnly(false);
    setReason('');
  }, [open, initialSlots]);

  // Validação por slot
  const errors = useMemo(() => {
    return slots.map((s) => {
      const startM = s.start_hour * 60 + s.start_minute;
      const endM = s.end_hour * 60 + s.end_minute;
      if (endM <= startM) return 'Fim precisa ser depois do início';
      if (
        s.bid_modifier !== null &&
        s.bid_modifier !== undefined &&
        (s.bid_modifier < 0.1 || s.bid_modifier > 10)
      ) {
        return 'Bid modifier precisa estar entre 0.1 e 10';
      }
      return null;
    });
  }, [slots]);
  const hasErrors = errors.some((e) => e !== null);

  // Detecta sobreposições (warning)
  const overlaps = useMemo(() => {
    const out: Set<string> = new Set();
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        if (a.day_of_week !== b.day_of_week) continue;
        const aStart = a.start_hour * 60 + a.start_minute;
        const aEnd = a.end_hour * 60 + a.end_minute;
        const bStart = b.start_hour * 60 + b.start_minute;
        const bEnd = b.end_hour * 60 + b.end_minute;
        if (aStart < bEnd && bStart < aEnd) {
          out.add(a.id);
          out.add(b.id);
        }
      }
    }
    return out;
  }, [slots]);

  function addSlot() {
    setSlots((prev) => [
      ...prev,
      {
        id: newSlotId(),
        day_of_week: 'MONDAY',
        start_hour: 9,
        start_minute: 0,
        end_hour: 18,
        end_minute: 0,
        bid_modifier: null,
      },
    ]);
  }

  function removeSlot(id: string) {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  }

  function updateSlot(id: string, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  // Presets
  function applyPresetCommercial() {
    if (
      slots.length > 0 &&
      !confirm('Substituir agendamento atual por Seg-Sex 09:00–18:00?')
    )
      return;
    const businessDays: Day[] = [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
    ];
    setSlots(
      businessDays.map((d) => ({
        id: newSlotId(),
        day_of_week: d,
        start_hour: 9,
        start_minute: 0,
        end_hour: 18,
        end_minute: 0,
        bid_modifier: null,
      })),
    );
  }
  function applyPresetExtended() {
    if (slots.length > 0 && !confirm('Substituir agendamento atual?')) return;
    const businessDays: Day[] = [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
    ];
    setSlots([
      ...businessDays.map((d) => ({
        id: newSlotId(),
        day_of_week: d,
        start_hour: 7,
        start_minute: 0 as const,
        end_hour: 22,
        end_minute: 0 as const,
        bid_modifier: null,
      })),
      {
        id: newSlotId(),
        day_of_week: 'SATURDAY' as Day,
        start_hour: 8,
        start_minute: 0,
        end_hour: 18,
        end_minute: 0,
        bid_modifier: null,
      },
    ]);
  }
  function applyPresetAllHours() {
    if (slots.length > 0 && !confirm('Remover todos os slots? Campanha vai rodar 24/7.'))
      return;
    setSlots([]);
  }

  async function submit() {
    if (!campaignId) return;
    if (hasErrors) {
      showError('Corrija os erros antes de salvar.');
      return;
    }
    setSubmitting(true);
    try {
      await api.put(`/trafego/campaigns/${campaignId}/schedule`, {
        slots: slots.map((s) => ({
          day_of_week: s.day_of_week,
          start_hour: s.start_hour,
          start_minute: s.start_minute,
          end_hour: s.end_hour,
          end_minute: s.end_minute,
          bid_modifier:
            s.bid_modifier !== null && s.bid_modifier !== undefined
              ? Number(s.bid_modifier)
              : undefined,
        })),
        reason: reason.trim() || undefined,
        validate_only: validateOnly,
      });
      showSuccess(
        validateOnly
          ? 'Validação dry-run enfileirada — confira em mutate-logs.'
          : `Agendamento atualizado (${slots.length} slot${slots.length === 1 ? '' : 's'}).`,
      );
      onSaved();
      onClose();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao salvar.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || !campaignId) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Clock size={18} className="text-violet-600" />
              <h3 className="text-base font-bold text-foreground">
                Editar agendamento
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Campanha: <span className="font-mono">{campaignName}</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Substituição atômica — todos os slots são removidos e recriados.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {/* Presets */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              type="button"
              onClick={applyPresetCommercial}
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-border hover:bg-accent"
            >
              Horário comercial
            </button>
            <button
              type="button"
              onClick={applyPresetExtended}
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-border hover:bg-accent"
            >
              Horário estendido
            </button>
            <button
              type="button"
              onClick={applyPresetAllHours}
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-border hover:bg-accent"
            >
              24/7 (sem restrição)
            </button>
          </div>

          {slots.length === 0 ? (
            <div className="bg-muted/30 border border-border rounded-lg p-6 text-center">
              <Clock size={28} className="mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-foreground font-semibold">
                Sem slots configurados
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Campanha vai rodar 24/7 (todos os dias e horas).
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold px-2 mb-1">
                <span className="col-span-2">Dia</span>
                <span className="col-span-2">Início</span>
                <span className="col-span-2">Fim</span>
                <span className="col-span-3">Ajuste lance</span>
                <span className="col-span-2">Status</span>
                <span className="col-span-1"></span>
              </div>
              {slots.map((slot, idx) => {
                const err = errors[idx];
                const isOverlapping = overlaps.has(slot.id);
                return (
                  <div
                    key={slot.id}
                    className={`grid grid-cols-12 gap-2 items-center p-2 rounded border ${
                      err
                        ? 'border-red-500/30 bg-red-500/5'
                        : isOverlapping
                          ? 'border-amber-500/30 bg-amber-500/5'
                          : 'border-border'
                    }`}
                  >
                    <select
                      value={slot.day_of_week}
                      onChange={(e) =>
                        updateSlot(slot.id, {
                          day_of_week: e.target.value as Day,
                        })
                      }
                      className="col-span-2 px-2 py-1.5 text-xs bg-background border border-border rounded"
                    >
                      {DAYS.map((d) => (
                        <option key={d.v} value={d.v}>
                          {d.label}
                        </option>
                      ))}
                    </select>

                    <div className="col-span-2 flex gap-1">
                      <select
                        value={slot.start_hour}
                        onChange={(e) =>
                          updateSlot(slot.id, {
                            start_hour: Number(e.target.value),
                          })
                        }
                        className="flex-1 px-1.5 py-1.5 text-xs bg-background border border-border rounded"
                      >
                        {Array.from({ length: 24 }).map((_, h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, '0')}h
                          </option>
                        ))}
                      </select>
                      <select
                        value={slot.start_minute}
                        onChange={(e) =>
                          updateSlot(slot.id, {
                            start_minute: Number(e.target.value) as any,
                          })
                        }
                        className="w-14 px-1 py-1.5 text-xs bg-background border border-border rounded"
                      >
                        {MINUTES.map((m) => (
                          <option key={m} value={m}>
                            {String(m).padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-2 flex gap-1">
                      <select
                        value={slot.end_hour}
                        onChange={(e) =>
                          updateSlot(slot.id, {
                            end_hour: Number(e.target.value),
                          })
                        }
                        className="flex-1 px-1.5 py-1.5 text-xs bg-background border border-border rounded"
                      >
                        {Array.from({ length: 25 }).map((_, h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, '0')}h
                          </option>
                        ))}
                      </select>
                      <select
                        value={slot.end_minute}
                        onChange={(e) =>
                          updateSlot(slot.id, {
                            end_minute: Number(e.target.value) as any,
                          })
                        }
                        className="w-14 px-1 py-1.5 text-xs bg-background border border-border rounded"
                      >
                        {MINUTES.map((m) => (
                          <option key={m} value={m}>
                            {String(m).padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-3">
                      <BidModifierField
                        value={slot.bid_modifier}
                        onChange={(v) =>
                          updateSlot(slot.id, { bid_modifier: v })
                        }
                      />
                    </div>

                    <div className="col-span-2 text-[10px]">
                      {err ? (
                        <span className="text-red-500 font-bold">{err}</span>
                      ) : isOverlapping ? (
                        <span className="text-amber-600 font-bold flex items-center gap-1">
                          <AlertTriangle size={9} /> Sobrepõe
                        </span>
                      ) : (
                        <span className="text-emerald-600">OK</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      title="Remover slot"
                      className="col-span-1 p-1.5 text-muted-foreground hover:text-red-500 justify-self-end"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={addSlot}
            className="mt-3 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md border border-dashed border-border hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <Plus size={11} /> Adicionar slot
          </button>

          <div className="mt-5 pt-4 border-t border-border space-y-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Motivo (audit log)
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex: reduzir veiculação noturna pra economizar budget"
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={validateOnly}
                onChange={(e) => setValidateOnly(e.target.checked)}
              />
              Modo conselheiro (validar sem aplicar)
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || hasErrors}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {validateOnly ? 'Validar' : 'Salvar agendamento'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BidModifierField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  // UI mostra como percentual (-50%, +25%) mas armazena como multiplier
  const [text, setText] = useState(
    value !== null && value !== undefined
      ? `${Math.round((value - 1) * 100)}`
      : '',
  );

  useEffect(() => {
    setText(
      value !== null && value !== undefined
        ? `${Math.round((value - 1) * 100)}`
        : '',
    );
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setText(v);
    if (v.trim() === '') {
      onChange(null);
      return;
    }
    const pct = parseFloat(v.replace(',', '.'));
    if (!Number.isFinite(pct)) {
      onChange(null);
      return;
    }
    // -90% = 0.1, +900% = 10.0 (limites Google)
    const multiplier = 1 + pct / 100;
    onChange(Math.max(0.1, Math.min(10, multiplier)));
  }

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={handleChange}
        placeholder="0"
        className="w-full pl-2 pr-7 py-1.5 text-xs bg-background border border-border rounded"
        title="Ex: 25 (+25%), -20 (-20%), vazio (sem ajuste)"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
        %
      </span>
    </div>
  );
}

function clampMinute(m: number): 0 | 15 | 30 | 45 {
  if (m >= 38) return 45;
  if (m >= 23) return 30;
  if (m >= 8) return 15;
  return 0;
}
