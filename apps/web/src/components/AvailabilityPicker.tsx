'use client';

import { useState, useEffect } from 'react';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/lib/api';

interface Props {
  userId: string;
  duration?: number; // minutes, default 30
  onSelectSlot: (start: string, end: string) => void;
}

export function AvailabilityPicker({ userId, duration = 30, onSelectSlot }: Props) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [slots, setSlots] = useState<{ start: string; end: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId || !selectedDate) return;
    setLoading(true);
    api.get(`/calendar/availability/${userId}`, { params: { date: selectedDate, duration } })
      .then(r => setSlots(r.data || []))
      .catch(() => setSlots([]))
      .finally(() => setLoading(false));
  }, [userId, selectedDate, duration]);

  const changeDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const dateLabel = new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'short', day: 'numeric', month: 'short'
  });

  return (
    <div className="border border-border rounded-lg p-3 bg-background/50">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Clock size={10} /> Horarios disponiveis
        </p>
        <div className="flex items-center gap-1">
          <button onClick={() => changeDate(-1)} className="p-0.5 rounded hover:bg-accent text-muted-foreground">
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] font-medium text-foreground min-w-[100px] text-center">{dateLabel}</span>
          <button onClick={() => changeDate(1)} className="p-0.5 rounded hover:bg-accent text-muted-foreground">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[11px] text-muted-foreground text-center py-2">Carregando...</p>
      ) : slots.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-2">Nenhum horario disponivel</p>
      ) : (
        <div className="grid grid-cols-4 gap-1 max-h-[120px] overflow-y-auto custom-scrollbar">
          {slots.map((s, i) => (
            <button
              key={i}
              onClick={() => onSelectSlot(s.start, s.end)}
              className="px-1.5 py-1 rounded border border-border text-[11px] font-medium text-foreground hover:bg-primary/10 hover:border-primary/30 transition-colors"
            >
              {s.start}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
