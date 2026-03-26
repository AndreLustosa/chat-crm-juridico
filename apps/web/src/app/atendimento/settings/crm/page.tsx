'use client';

import { useState, useEffect } from 'react';
import { Kanban, AlertCircle, Loader2, Cloud, CloudOff } from 'lucide-react';
import api from '@/lib/api';

const PRESETS = [1, 2, 3, 5, 7, 14];

export default function CrmSettingsPage() {
  const [days, setDays] = useState<number>(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Buscar configuração do banco de dados
  useEffect(() => {
    api.get('/settings/crm-config')
      .then(r => {
        setDays(r.data.stagnationDays ?? 3);
        setError(null);
      })
      .catch(() => setError('Não foi possível carregar as configurações.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (value: number) => {
    const clamped = Math.max(1, Math.round(value));
    setDays(clamped);
    setSaving(true);
    setError(null);
    try {
      await api.patch('/settings/crm-config', { stagnationDays: clamped });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('Erro ao salvar. Verifique suas permissões.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Kanban className="text-primary" size={22} />
          <h1 className="text-2xl font-bold">CRM Pipeline</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Configurações do funil de captação e alertas de leads.
        </p>
      </div>

      {/* Alerta de estagnação */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <AlertCircle size={15} className="text-muted-foreground" />
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Alerta de Leads Estagnados
          </h2>
          <div className="ml-auto flex items-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
            {saved && !saving && (
              <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                <Cloud size={12} /> Salvo
              </span>
            )}
            {error && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <CloudOff size={12} /> {error}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 size={14} className="animate-spin" /> Carregando configurações…
          </div>
        ) : (
          <>
            <div>
              <p className="text-[14px] font-semibold mb-1">Prazo sem atividade</p>
              <p className="text-[12px] text-muted-foreground mb-4">
                Exibir alerta no CRM quando um lead ficar sem mensagem por pelo menos{' '}
                <span className="text-foreground font-bold">{days} dia{days !== 1 ? 's' : ''}</span>.
              </p>

              {/* Presets */}
              <div className="flex flex-wrap gap-2 mb-4">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => handleSave(p)}
                    disabled={saving}
                    className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold border transition-all disabled:opacity-50 ${
                      days === p
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    {p} dia{p !== 1 ? 's' : ''}
                  </button>
                ))}
              </div>

              {/* Input manual */}
              <div className="flex items-center gap-3">
                <label className="text-[13px] text-muted-foreground shrink-0">Ou digite:</label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={days}
                  disabled={saving}
                  onChange={(e) => setDays(Number(e.target.value))}
                  onBlur={(e) => handleSave(Number(e.target.value))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(Number((e.target as HTMLInputElement).value)); }}
                  className="w-20 px-3 py-1.5 rounded-lg border border-border bg-background text-[13px] text-center focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                />
                <span className="text-[13px] text-muted-foreground">dias</span>
              </div>
            </div>

            <div className="pt-2 border-t border-border text-[12px] text-muted-foreground">
              O alerta aparece no topo do CRM Pipeline e lista os leads sem mensagem além deste prazo (exceto Finalizado e Perdido).{' '}
              <span className="text-primary/70">A preferência é salva no banco de dados e sincronizada entre todos os dispositivos.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
