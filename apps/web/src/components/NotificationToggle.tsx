'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

// Sentinela: muted_until >= now + 10 anos = "desligado permanentemente".
// Valores menores são DND temporário (controlado pela página /settings/notifications).
const PERMANENT_OFF_DATE = '2099-12-31T23:59:59.000Z';
const PERMANENT_THRESHOLD_YEARS = 10;

function isPermanentOff(mutedUntil: string | null | undefined): boolean {
  if (!mutedUntil) return false;
  const until = new Date(mutedUntil).getTime();
  const threshold = Date.now() + PERMANENT_THRESHOLD_YEARS * 365 * 24 * 60 * 60 * 1000;
  return until >= threshold;
}

interface NotificationToggleProps {
  /** Layout compacto da sidebar (colapsada) mostra só o ícone; expandido mostra label+switch */
  variant: 'sidebar-expanded' | 'sidebar-collapsed' | 'mobile-menu';
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
}

export function NotificationToggle({ variant, onMouseEnter, onMouseLeave }: NotificationToggleProps) {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/users/me/notification-settings', { _silent401: true } as any);
      setEnabled(!isPermanentOff(data?.muted_until));
    } catch {
      // Falha silenciosa — mantém estado otimista (ligado)
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sincroniza quando a página /settings/notifications altera preferências
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('notification_settings_changed', handler);
    return () => window.removeEventListener('notification_settings_changed', handler);
  }, [load]);

  const toggle = async () => {
    if (saving) return;
    const next = !enabled;
    setEnabled(next); // otimista
    setSaving(true);
    try {
      await api.patch('/users/me/notification-settings', {
        muted_until: next ? null : PERMANENT_OFF_DATE,
      });
      window.dispatchEvent(new CustomEvent('notification_settings_changed'));
      toast.success(next ? 'Notificações ligadas' : 'Notificações desligadas', { duration: 2000 });
    } catch {
      setEnabled(!next); // rollback
      toast.error('Não foi possível salvar preferência');
    } finally {
      setSaving(false);
    }
  };

  const Icon = enabled ? Bell : BellOff;
  const label = enabled ? 'Notificações' : 'Notificações desligadas';
  const tooltip = enabled ? 'Desligar notificações' : 'Ligar notificações';

  // ─── Sidebar colapsada (só ícone centralizado) ────────────────────
  if (variant === 'sidebar-collapsed') {
    return (
      <button
        onClick={toggle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        title={tooltip}
        disabled={loading || saving}
        className={`w-full aspect-square rounded-xl flex items-center justify-center shadow-sm transition-colors ${
          enabled
            ? 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
        } disabled:opacity-60`}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Icon size={18} strokeWidth={2} />}
      </button>
    );
  }

  // ─── Sidebar expandida: ícone + label + switch ────────────────────
  if (variant === 'sidebar-expanded') {
    return (
      <button
        onClick={toggle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        disabled={loading || saving}
        className={`w-full rounded-xl flex items-center gap-2.5 shadow-sm transition-colors px-2.5 py-2 ${
          enabled
            ? 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
        } disabled:opacity-60`}
        title={tooltip}
      >
        {loading ? (
          <Loader2 size={18} className="animate-spin shrink-0" />
        ) : (
          <Icon size={18} strokeWidth={2} className="shrink-0" />
        )}
        <span className="text-[13px] font-medium flex-1 text-left">{label}</span>
        <span
          className={`inline-flex items-center h-4 w-7 rounded-full transition-colors shrink-0 ${
            enabled ? 'bg-primary' : 'bg-muted-foreground/30'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${
              enabled ? 'translate-x-3.5' : 'translate-x-0.5'
            }`}
          />
        </span>
      </button>
    );
  }

  // ─── Mobile menu (full-width linha) ───────────────────────────────
  return (
    <button
      onClick={toggle}
      disabled={loading || saving}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        enabled
          ? 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
      } disabled:opacity-60`}
    >
      {loading ? (
        <Loader2 size={20} className="animate-spin shrink-0" />
      ) : (
        <Icon size={20} strokeWidth={2} className="shrink-0" />
      )}
      <span className="flex-1 text-left">{label}</span>
      <span
        className={`inline-flex items-center h-5 w-9 rounded-full transition-colors shrink-0 ${
          enabled ? 'bg-primary' : 'bg-muted-foreground/30'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}
