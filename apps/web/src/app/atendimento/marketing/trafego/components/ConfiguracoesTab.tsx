'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Mail, MessageCircle, Bell, Clock } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface Settings {
  target_cpl_brl: number;
  target_ctr: number;
  target_roas: number;
  target_daily_budget_brl: number | null;
  cpl_alert_threshold: number;
  ctr_alert_threshold: number;
  alert_window_days: number;
  notify_email: boolean;
  notify_whatsapp: boolean;
  notify_whatsapp_phone: string | null;
  notify_inapp: boolean;
  sync_hour_local: number;
  sync_enabled: boolean;
}

export function ConfiguracoesTab({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<Settings>('/trafego/settings');
        setSettings(data);
      } catch {
        showError('Erro ao carregar configurações.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    if (!settings || !canManage) return;
    setSaving(true);
    try {
      await api.patch('/trafego/settings', settings);
      showSuccess('Configurações salvas.');
    } catch {
      showError('Erro ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 size={28} className="animate-spin mb-2" />
        <p className="text-sm">Carregando configurações...</p>
      </div>
    );
  }

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ─── Metas ──────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-bold text-foreground mb-4">Metas</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="CPL alvo (R$)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={settings.target_cpl_brl ?? 0}
              onChange={(e) => update('target_cpl_brl', Number(e.target.value))}
              disabled={!canManage}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </Field>
          <Field label="CTR alvo (%)">
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={(settings.target_ctr ?? 0) * 100}
              onChange={(e) => update('target_ctr', Number(e.target.value) / 100)}
              disabled={!canManage}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </Field>
          <Field label="ROAS alvo">
            <input
              type="number"
              step="0.1"
              min="0"
              value={settings.target_roas ?? 0}
              onChange={(e) => update('target_roas', Number(e.target.value))}
              disabled={!canManage}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </Field>
          <Field label="Orçamento diário alvo (R$, opcional)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={settings.target_daily_budget_brl ?? ''}
              onChange={(e) =>
                update(
                  'target_daily_budget_brl',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
              disabled={!canManage}
              placeholder="Sem alvo"
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </Field>
        </div>
      </section>

      {/* ─── Thresholds de alerta ─────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-bold text-foreground mb-1">
          Sensibilidade dos alertas
        </h3>
        <p className="text-[11px] text-muted-foreground mb-4">
          Quanto fora da meta antes de disparar alerta.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="CPL — disparar com +X%">
            <input
              type="number"
              step="1"
              min="0"
              max="500"
              value={(settings.cpl_alert_threshold ?? 0) * 100}
              onChange={(e) => update('cpl_alert_threshold', Number(e.target.value) / 100)}
              disabled={!canManage}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </Field>
          <Field label="CTR — disparar com -X%">
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={(settings.ctr_alert_threshold ?? 0) * 100}
              onChange={(e) => update('ctr_alert_threshold', Number(e.target.value) / 100)}
              disabled={!canManage}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </Field>
          <Field label="Janela (dias)">
            <input
              type="number"
              step="1"
              min="1"
              max="90"
              value={settings.alert_window_days ?? 7}
              onChange={(e) => update('alert_window_days', Number(e.target.value))}
              disabled={!canManage}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </Field>
        </div>
      </section>

      {/* ─── Canais de notificação ───────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-bold text-foreground mb-4">
          Canais de notificação
        </h3>
        <div className="space-y-3">
          <Toggle
            icon={Mail}
            label="E-mail"
            checked={settings.notify_email}
            onChange={(v) => update('notify_email', v)}
            disabled={!canManage}
          />
          <Toggle
            icon={Bell}
            label="In-app (sino)"
            checked={settings.notify_inapp}
            onChange={(v) => update('notify_inapp', v)}
            disabled={!canManage}
          />
          <Toggle
            icon={MessageCircle}
            label="WhatsApp"
            checked={settings.notify_whatsapp}
            onChange={(v) => update('notify_whatsapp', v)}
            disabled={!canManage}
          />
          {settings.notify_whatsapp && (
            <div className="ml-7">
              <Field label="Telefone (E.164, ex: +5582999999999)">
                <input
                  type="tel"
                  value={settings.notify_whatsapp_phone ?? ''}
                  onChange={(e) =>
                    update('notify_whatsapp_phone', e.target.value || null)
                  }
                  disabled={!canManage}
                  placeholder="+5582999999999"
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
              </Field>
            </div>
          )}
        </div>
      </section>

      {/* ─── Sync ──────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-bold text-foreground mb-4">
          Sincronização automática
        </h3>
        <div className="space-y-4">
          <Toggle
            icon={Clock}
            label="Sync diário ativado"
            checked={settings.sync_enabled}
            onChange={(v) => update('sync_enabled', v)}
            disabled={!canManage}
          />
          <Field label="Hora do sync (Maceió, 0-23)">
            <input
              type="number"
              step="1"
              min="0"
              max="23"
              value={settings.sync_hour_local ?? 6}
              onChange={(e) => update('sync_hour_local', Number(e.target.value))}
              disabled={!canManage}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 w-24"
            />
          </Field>
        </div>
      </section>

      {canManage && (
        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-4 py-2 rounded-lg shadow-md hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            Salvar configurações
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  icon: Icon,
  label,
  checked,
  onChange,
  disabled,
}: {
  icon: any;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-4 h-4 accent-primary"
      />
      <Icon size={16} className="text-muted-foreground" />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}
