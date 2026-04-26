'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, AlertCircle, Calendar, Clock, ArrowLeft, ArrowRight,
  CheckCircle2, User, Phone, Video, MapPin,
} from 'lucide-react';
import { PortalHeader } from '../components/PortalHeader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

type Modality = 'LIGACAO' | 'VIDEO' | 'PRESENCIAL';

const MODALITIES: Array<{
  value: Modality;
  label: string;
  emoji: string;
  duration: number;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    value: 'LIGACAO',
    label: 'Ligação telefônica',
    emoji: '📞',
    duration: 15,
    description: 'Conversa rápida por telefone — ideal pra dúvidas pontuais',
    icon: Phone,
  },
  {
    value: 'VIDEO',
    label: 'Videochamada',
    emoji: '💻',
    duration: 30,
    description: 'Reunião por vídeo — ótima pra apresentar documentos ou discutir estratégia',
    icon: Video,
  },
  {
    value: 'PRESENCIAL',
    label: 'Atendimento presencial',
    emoji: '📍',
    duration: 30,
    description: 'No escritório em Arapiraca — pra assinaturas e conversas mais aprofundadas',
    icon: MapPin,
  },
];

type Slot = { start: string; end: string };
type Availability = {
  lawyer: { name: string | null };
  modality: { value: Modality; label: string; duration_minutes: number; emoji: string };
  slots: Slot[];
};
type Appointment = {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  status: string;
  lawyer_name: string | null;
};

const REASONS = [
  'Tirar dúvidas sobre o processo',
  'Atualização do caso',
  'Discutir estratégia',
  'Apresentar documentos novos',
  'Outro assunto',
];

function formatBrDate(iso: string, withTime = true): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  };
  if (withTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }
  return new Date(iso).toLocaleString('pt-BR', opts);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
}

function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC',
  });
}

type Step = 'modality' | 'reason' | 'slot' | 'confirm' | 'success';

export default function AgendarPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('modality');
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modality, setModality] = useState<Modality | null>(null);
  const [reason, setReason] = useState<string>('');
  const [reasonOther, setReasonOther] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdAppointment, setCreatedAppointment] = useState<{
    start_at: string;
    lawyer_name: string | null;
    reason: string;
    modality_label: string;
  } | null>(null);

  // Carrega lista de consultas existentes ao montar
  useEffect(() => {
    fetch(`${API_BASE}/portal/scheduling/my-appointments`, { credentials: 'include' })
      .then(async r => {
        if (r.status === 401) { router.push('/portal'); return null; }
        if (!r.ok) return null;
        return r.json();
      })
      .then(data => { if (data) setAppointments(data); })
      .catch(() => {});
  }, [router]);

  // Quando escolhe modalidade, carrega slots dessa modalidade
  async function selectModality(m: Modality) {
    setModality(m);
    setError(null);
    setLoadingSlots(true);
    setAvailability(null);
    try {
      const res = await fetch(
        `${API_BASE}/portal/scheduling/availability?modality=${m}`,
        { credentials: 'include' },
      );
      if (res.status === 401) { router.push('/portal'); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setAvailability(data);
      setStep('reason');
    } catch (e: any) {
      setError(e.message || 'Falha ao carregar horários');
    } finally {
      setLoadingSlots(false);
    }
  }

  async function submit() {
    if (!selectedSlot || !modality) return;
    const finalReason = reason === 'Outro assunto' ? reasonOther.trim() : reason;
    if (!finalReason) {
      setError('Por favor, descreva o motivo.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/portal/scheduling`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_at: selectedSlot.start,
          modality,
          reason: finalReason,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCreatedAppointment({
        start_at: data.start_at,
        lawyer_name: data.lawyer_name,
        reason: data.reason,
        modality_label: data.modality_label,
      });
      setStep('success');
    } catch (e: any) {
      setError(e.message || 'Falha ao agendar');
    } finally {
      setSubmitting(false);
    }
  }

  // Agrupa slots por dia
  const slotsByDay = new Map<string, Slot[]>();
  if (availability) {
    for (const slot of availability.slots) {
      const day = slot.start.slice(0, 10);
      if (!slotsByDay.has(day)) slotsByDay.set(day, []);
      slotsByDay.get(day)!.push(slot);
    }
  }
  const days = Array.from(slotsByDay.keys()).slice(0, 14); // máx 2 semanas no UI

  return (
    <>
      <PortalHeader showBack />
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Agendar consulta</h1>
          <p className="text-white/50 text-sm">
            Escolha um horário pra conversar com seu advogado.
            {availability?.lawyer.name && (
              <> Você será atendido por <strong className="text-white/80">{availability.lawyer.name}</strong>.</>
            )}
          </p>
        </div>

        {/* Consultas já marcadas */}
        {appointments.length > 0 && step !== 'success' && (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="text-xs font-bold text-emerald-300 uppercase tracking-wider mb-2">
              ✅ Você já tem {appointments.length === 1 ? 'uma consulta' : `${appointments.length} consultas`} marcada{appointments.length !== 1 && 's'}
            </p>
            <ul className="space-y-1">
              {appointments.map(a => (
                <li key={a.id} className="text-sm text-white/80">
                  📅 {formatBrDate(a.start_at)}
                  {a.lawyer_name && ` com ${a.lawyer_name}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && step !== 'success' && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2">
            <AlertCircle className="text-red-400 mt-0.5 shrink-0" size={16} />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Indicador de etapa — sempre visivel exceto em success */}
        {step !== 'success' && (
          <div className="flex items-center justify-center gap-2 mb-8 flex-wrap">
            <StepDot active={step === 'modality'} done={step !== 'modality'} label="1. Tipo" />
            <div className="w-6 h-px bg-white/10" />
            <StepDot active={step === 'reason'} done={['slot', 'confirm'].includes(step)} label="2. Motivo" />
            <div className="w-6 h-px bg-white/10" />
            <StepDot active={step === 'slot'} done={step === 'confirm'} label="3. Horário" />
            <div className="w-6 h-px bg-white/10" />
            <StepDot active={step === 'confirm'} done={false} label="4. Confirmar" />
          </div>
        )}

        {/* PASSO 1: modalidade */}
        {step === 'modality' && (
          <div className="space-y-4">
            <p className="text-sm font-bold text-white">Como você prefere ser atendido?</p>
            <div className="space-y-3">
              {MODALITIES.map(m => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.value}
                    onClick={() => selectModality(m.value)}
                    disabled={loadingSlots}
                    className="w-full text-left p-4 rounded-xl border border-white/10 bg-[#0d0d14] hover:border-[#A89048]/40 hover:bg-[#13131c] transition-all disabled:opacity-50 group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-lg bg-[#A89048]/15 border border-[#A89048]/30 flex items-center justify-center shrink-0 group-hover:bg-[#A89048]/25 transition-colors">
                        <Icon size={20} className="text-[#A89048]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                          <h3 className="font-bold text-base text-white">{m.label}</h3>
                          <span className="text-[10px] font-bold text-[#A89048] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#A89048]/10 border border-[#A89048]/30">
                            {m.duration} min
                          </span>
                        </div>
                        <p className="text-sm text-white/60">{m.description}</p>
                      </div>
                      {loadingSlots && modality === m.value ? (
                        <Loader2 className="animate-spin text-[#A89048] shrink-0" size={18} />
                      ) : (
                        <ArrowRight size={16} className="text-white/30 group-hover:text-[#A89048] shrink-0 mt-2 transition-colors" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {availability && (
          <>
            {/* Banner com modalidade selecionada — sempre visivel apos passo 1 */}
            {step !== 'success' && step !== 'modality' && modality && (
              <div className="mb-4 rounded-xl border border-[#A89048]/30 bg-[#A89048]/5 p-3 flex items-center gap-3">
                <span className="text-2xl">{availability.modality.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{availability.modality.label}</p>
                  <p className="text-xs text-white/60">{availability.modality.duration_minutes} minutos</p>
                </div>
                <button
                  onClick={() => { setStep('modality'); setSelectedSlot(null); setReason(''); }}
                  className="text-xs text-[#A89048] hover:text-[#B89A50] font-bold transition-colors"
                >
                  Trocar
                </button>
              </div>
            )}

            {/* PASSO 2: motivo */}
            {step === 'reason' && (
              <div className="space-y-4">
                <p className="text-sm font-bold text-white">Sobre o que você quer conversar?</p>
                <div className="space-y-2">
                  {REASONS.map(r => (
                    <button
                      key={r}
                      onClick={() => setReason(r)}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                        reason === r
                          ? 'border-[#A89048] bg-[#A89048]/10 text-white'
                          : 'border-white/10 bg-[#0d0d14] text-white/70 hover:border-white/20'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {reason === 'Outro assunto' && (
                  <input
                    type="text"
                    placeholder="Descreva brevemente o assunto"
                    value={reasonOther}
                    onChange={e => setReasonOther(e.target.value.slice(0, 200))}
                    className="w-full bg-[#16161f] border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-[#A89048] focus:outline-none"
                    autoFocus
                  />
                )}
                <button
                  onClick={() => { setError(null); setStep('slot'); }}
                  disabled={!reason || (reason === 'Outro assunto' && !reasonOther.trim())}
                  className="w-full flex items-center justify-center gap-2 bg-[#A89048] hover:bg-[#B89A50] disabled:opacity-40 disabled:cursor-not-allowed text-[#0a0a0f] font-bold py-3.5 rounded-xl transition-colors"
                >
                  Próximo <ArrowRight size={16} />
                </button>
              </div>
            )}

            {/* PASSO 2: slot */}
            {step === 'slot' && (
              <div className="space-y-4">
                <button
                  onClick={() => setStep('reason')}
                  className="text-white/50 hover:text-white text-sm flex items-center gap-1"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <p className="text-sm font-bold text-white">Escolha um dia e horário</p>
                {availability.slots.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-[#0d0d14] p-8 text-center">
                    <p className="text-white/60 text-sm">
                      Não há horários disponíveis nas próximas semanas.
                      Por favor, fale com o escritório pelo WhatsApp.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[28rem] overflow-y-auto custom-scrollbar pr-1">
                    {days.map(day => (
                      <DaySlots
                        key={day}
                        day={day}
                        slots={slotsByDay.get(day) || []}
                        selected={selectedSlot}
                        onSelect={(s) => { setSelectedSlot(s); setStep('confirm'); }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* PASSO 3: confirmar */}
            {step === 'confirm' && selectedSlot && (
              <div className="space-y-4">
                <button
                  onClick={() => setStep('slot')}
                  className="text-white/50 hover:text-white text-sm flex items-center gap-1"
                >
                  <ArrowLeft size={14} /> Trocar horário
                </button>

                <div className="rounded-xl border border-[#A89048]/30 bg-[#A89048]/5 p-5 space-y-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#A89048] font-bold mb-1">Confirme sua consulta</p>
                    <p className="text-xl font-bold text-white capitalize">
                      {formatDayLabel(selectedSlot.start)}
                    </p>
                    <p className="text-base text-white/80 mt-0.5">
                      Das {formatTime(selectedSlot.start)} às {formatTime(selectedSlot.end)}
                    </p>
                  </div>
                  <div className="pt-3 border-t border-white/10">
                    <p className="text-xs text-white/50 mb-1">Modalidade</p>
                    <p className="text-sm text-white flex items-center gap-1.5">
                      <span>{availability.modality.emoji}</span>
                      <strong>{availability.modality.label}</strong>
                      <span className="text-white/50">({availability.modality.duration_minutes} min)</span>
                    </p>
                  </div>
                  {availability.lawyer.name && (
                    <div className="flex items-center gap-2 pt-3 border-t border-white/10">
                      <User size={14} className="text-white/50" />
                      <span className="text-sm text-white/70">
                        Com <strong className="text-white">{availability.lawyer.name}</strong>
                      </span>
                    </div>
                  )}
                  <div className="pt-3 border-t border-white/10">
                    <p className="text-xs text-white/50 mb-1">Motivo</p>
                    <p className="text-sm text-white">
                      {reason === 'Outro assunto' ? reasonOther : reason}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-white/50 mb-2">
                    Observações (opcional)
                  </label>
                  <textarea
                    placeholder="Algo que o advogado deva saber antes da consulta?"
                    value={notes}
                    onChange={e => setNotes(e.target.value.slice(0, 500))}
                    rows={3}
                    className="w-full bg-[#16161f] border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-[#A89048] focus:outline-none resize-none"
                  />
                </div>

                <button
                  onClick={submit}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 bg-[#A89048] hover:bg-[#B89A50] disabled:opacity-40 text-[#0a0a0f] font-bold py-3.5 rounded-xl transition-colors"
                >
                  {submitting ? (
                    <><Loader2 className="animate-spin" size={16} /> Confirmando…</>
                  ) : (
                    <><CheckCircle2 size={16} /> Confirmar consulta</>
                  )}
                </button>
              </div>
            )}

            {/* SUCESSO */}
            {step === 'success' && createdAppointment && (
              <div className="text-center py-8">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/40 mb-6">
                  <CheckCircle2 className="text-emerald-400" size={36} />
                </div>
                <h2 className="text-2xl font-bold mb-2">Consulta agendada! 🎉</h2>
                <p className="text-white/70 text-base mb-3">
                  Sua <strong className="text-white">{createdAppointment.modality_label.toLowerCase()}</strong> foi confirmada para<br />
                  <strong className="text-white text-lg capitalize">
                    {formatDayLabel(createdAppointment.start_at)}
                  </strong>
                  <br />
                  às <strong className="text-white text-lg">{formatTime(createdAppointment.start_at)}</strong>
                </p>
                {createdAppointment.lawyer_name && (
                  <p className="text-sm text-white/60 mb-2">
                    Com <strong className="text-white">{createdAppointment.lawyer_name}</strong>
                  </p>
                )}
                <p className="text-xs text-white/50 mb-8">
                  Seu advogado já foi notificado. Você receberá um lembrete antes da consulta.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    onClick={() => router.push('/portal')}
                    className="bg-[#A89048] hover:bg-[#B89A50] text-[#0a0a0f] font-bold px-6 py-3 rounded-xl transition-colors"
                  >
                    Voltar ao portal
                  </button>
                  <button
                    onClick={() => router.push('/portal/agendar')}
                    className="border border-white/20 text-white/80 hover:bg-white/5 font-bold px-6 py-3 rounded-xl transition-colors"
                  >
                    Agendar outra consulta
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2.5 h-2.5 rounded-full transition-colors ${
        done ? 'bg-emerald-400' :
        active ? 'bg-[#A89048] ring-2 ring-[#A89048]/30 animate-pulse' :
        'bg-white/20'
      }`} />
      <span className={`text-[10px] uppercase tracking-wider font-bold ${
        active || done ? 'text-white/70' : 'text-white/30'
      }`}>{label}</span>
    </div>
  );
}

function DaySlots({
  day,
  slots,
  selected,
  onSelect,
}: {
  day: string;
  slots: Slot[];
  selected: Slot | null;
  onSelect: (s: Slot) => void;
}) {
  if (slots.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider mb-2 capitalize">
        <Calendar size={12} className="inline mr-1.5 mb-0.5" />
        {formatDayLabel(`${day}T00:00:00.000Z`)}
      </h3>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {slots.map(s => {
          const isSelected = selected?.start === s.start;
          return (
            <button
              key={s.start}
              onClick={() => onSelect(s)}
              className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                isSelected
                  ? 'border-[#A89048] bg-[#A89048] text-[#0a0a0f]'
                  : 'border-white/10 bg-[#0d0d14] text-white/80 hover:border-[#A89048]/40 hover:bg-[#A89048]/5'
              }`}
            >
              <Clock size={11} className="inline mr-1" />
              {formatTime(s.start)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
