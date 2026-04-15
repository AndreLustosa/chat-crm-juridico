'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, Volume2, Play, Monitor, Palette, Moon, MessageSquare, ArrowRightLeft, Clock, Calendar, Scale, FileText, Wifi, FileCheck, Loader2 } from 'lucide-react';
import {
  NOTIFICATION_SOUNDS,
  playNotificationSound,
  type SoundId,
} from '@/lib/notificationSounds';
import {
  isDesktopNotifSupported,
  getDesktopNotifPermission,
  isDesktopNotifEnabled,
  setDesktopNotifEnabled,
  requestNotificationPermission,
} from '@/lib/desktopNotifications';
import { ThemeToggle } from '@/components/ThemeToggle';
import api from '@/lib/api';
import { isPushSupported, isPushSubscribed, subscribeToPush, unsubscribeFromPush } from '@/lib/pushSubscription';

// ─── Tipos de evento com labels e ícones ──────────────────────────
const EVENT_TYPES = [
  { key: 'incoming_message',  label: 'Novas mensagens',       icon: MessageSquare,  description: 'Mensagem recebida de lead/cliente' },
  { key: 'transfer_request',  label: 'Transferências',        icon: ArrowRightLeft, description: 'Recebeu uma transferência de conversa' },
  { key: 'task_overdue',      label: 'Tarefas vencendo',      icon: Clock,          description: 'Tarefa prestes a vencer ou vencida' },
  { key: 'calendar_reminder', label: 'Lembretes de agenda',   icon: Calendar,       description: 'Audiências, prazos e compromissos' },
  { key: 'legal_case_update', label: 'Processos',             icon: Scale,          description: 'Atualizações em processos jurídicos' },
  { key: 'petition_status',   label: 'Petições',              icon: FileText,       description: 'Status de petições (aprovada/devolvida)' },
  { key: 'contract_signed',   label: 'Contratos assinados',   icon: FileCheck,      description: 'Contrato assinado via Clicksign' },
  { key: 'connection_status', label: 'Status do WhatsApp',    icon: Wifi,           description: 'Conexão/desconexão da instância' },
] as const;

// ─── DND durations ───────────────────────────────────────────────
const DND_OPTIONS = [
  { label: '30 min',   ms: 30 * 60 * 1000 },
  { label: '1 hora',   ms: 60 * 60 * 1000 },
  { label: '2 horas',  ms: 2 * 60 * 60 * 1000 },
  { label: '4 horas',  ms: 4 * 60 * 60 * 1000 },
  { label: 'Até amanhã', ms: 0 }, // calculado dinamicamente
];

type Prefs = Record<string, { sound: boolean; desktop: boolean; email: boolean }>;

export default function NotificationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<SoundId>('ding');
  const [prefs, setPrefs] = useState<Prefs>({});
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const [permissionState, setPermissionState] = useState<'default' | 'granted' | 'denied'>('default');
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  // ─── Fetch settings do servidor ──────────────────────────────
  useEffect(() => {
    api.get('/users/me/notification-settings')
      .then(r => {
        setSelected(r.data.sound_id || 'ding');
        setPrefs(r.data.preferences || {});
        setMutedUntil(r.data.muted_until || null);
      })
      .catch(() => {
        // Fallback: migra do localStorage se servidor não respondeu
        const lsSound = localStorage.getItem('notification_sound_id');
        if (lsSound) setSelected(lsSound as SoundId);
      })
      .finally(() => setLoading(false));

    if (isDesktopNotifSupported()) {
      setPermissionState(getDesktopNotifPermission());
      setDesktopEnabled(isDesktopNotifEnabled());
    }

    // Web Push
    setPushSupported(isPushSupported());
    if (isPushSupported()) {
      isPushSubscribed().then(setPushEnabled);
    }
  }, []);

  // ─── Salvar no servidor (debounced) ──────────────────────────
  const saveToServer = useCallback(async (data: { preferences?: Prefs; sound_id?: string; muted_until?: string | null }) => {
    setSaving(true);
    try {
      await api.patch('/users/me/notification-settings', data);
      setSavedMsg('Salvo');
      setTimeout(() => setSavedMsg(''), 2000);
    } catch {
      setSavedMsg('Erro ao salvar');
      setTimeout(() => setSavedMsg(''), 3000);
    } finally {
      setSaving(false);
    }
  }, []);

  // ─── Handlers ────────────────────────────────────────────────
  const handleSelectSound = (id: SoundId) => {
    setSelected(id);
    playNotificationSound(id);
    saveToServer({ sound_id: id });
  };

  const togglePref = (eventKey: string, channel: 'sound' | 'desktop' | 'email') => {
    setPrefs(prev => {
      const current = prev[eventKey] || { sound: true, desktop: true, email: false };
      const updated = { ...prev, [eventKey]: { ...current, [channel]: !current[channel] } };
      saveToServer({ preferences: updated });
      return updated;
    });
  };

  const handleDND = (durationMs: number) => {
    let until: string;
    if (durationMs === 0) {
      // "Até amanhã": próximo dia 8h
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      until = tomorrow.toISOString();
    } else {
      until = new Date(Date.now() + durationMs).toISOString();
    }
    setMutedUntil(until);
    saveToServer({ muted_until: until });
  };

  const handleDisableDND = () => {
    setMutedUntil(null);
    saveToServer({ muted_until: null });
  };

  const handleToggleDesktopNotif = async () => {
    if (!isDesktopNotifSupported()) return;
    if (permissionState === 'default') {
      const result = await requestNotificationPermission();
      setPermissionState(result);
      if (result === 'granted') {
        setDesktopEnabled(true);
        setDesktopNotifEnabled(true);
      }
      return;
    }
    if (permissionState === 'granted') {
      const next = !desktopEnabled;
      setDesktopEnabled(next);
      setDesktopNotifEnabled(next);
    }
  };

  const isDND = mutedUntil && new Date(mutedUntil) > new Date();
  const dndRemaining = isDND ? Math.max(0, Math.ceil((new Date(mutedUntil!).getTime() - Date.now()) / 60000)) : 0;

  if (loading) {
    return (
      <div className="p-8 max-w-2xl flex items-center gap-3 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" /> Carregando preferências...
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Bell className="text-primary" size={22} />
          <h1 className="text-2xl font-bold">Notificações</h1>
          {(saving || savedMsg) && (
            <span className={`ml-auto text-xs font-semibold ${savedMsg === 'Erro ao salvar' ? 'text-destructive' : 'text-primary'}`}>
              {saving ? <Loader2 size={14} className="animate-spin inline" /> : savedMsg}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Configure alertas sonoros, notificações desktop e modo silencioso. As preferências sincronizam entre dispositivos.
        </p>
      </div>

      {/* ─── Não Perturbe (DND) ──────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Moon size={15} className="text-muted-foreground" />
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Não Perturbe
          </h2>
        </div>

        {isDND ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[14px] font-semibold text-sky-400">🔕 Modo silencioso ativo</p>
              <p className="text-[12px] text-muted-foreground">
                Sons e notificações desktop pausados por {dndRemaining > 60 ? `${Math.floor(dndRemaining / 60)}h ${dndRemaining % 60}min` : `${dndRemaining} min`}. Badges continuam atualizando.
              </p>
            </div>
            <button
              onClick={handleDisableDND}
              className="px-3 py-1.5 text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
            >
              Desativar
            </button>
          </div>
        ) : (
          <div>
            <p className="text-[13px] text-muted-foreground mb-3">
              Pause temporariamente todos os sons e notificações desktop:
            </p>
            <div className="flex flex-wrap gap-2">
              {DND_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => handleDND(opt.ms)}
                  className="px-3 py-1.5 text-xs font-semibold bg-muted/50 hover:bg-muted border border-border rounded-lg transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── Controle por tipo de evento ─────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <Bell size={15} className="text-muted-foreground" />
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Canais por Tipo de Evento
          </h2>
        </div>

        {/* Header */}
        <div className="grid grid-cols-[1fr_60px_60px_60px] gap-2 mb-2 px-1">
          <div />
          <div className="text-[10px] font-bold text-muted-foreground uppercase text-center">Som</div>
          <div className="text-[10px] font-bold text-muted-foreground uppercase text-center">Desktop</div>
          <div className="text-[10px] font-bold text-muted-foreground uppercase text-center">Email</div>
        </div>

        <div className="space-y-1">
          {EVENT_TYPES.map(evt => {
            const Icon = evt.icon;
            const p = prefs[evt.key] || { sound: true, desktop: true, email: false };
            return (
              <div key={evt.key} className="grid grid-cols-[1fr_60px_60px_60px] gap-2 items-center px-3 py-2.5 rounded-xl hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <Icon size={15} className="text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold truncate">{evt.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{evt.description}</p>
                  </div>
                </div>
                {/* Som toggle */}
                <div className="flex justify-center">
                  <button
                    onClick={() => togglePref(evt.key, 'sound')}
                    className={`w-9 h-5 rounded-full transition-colors relative ${p.sound ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${p.sound ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
                {/* Desktop toggle */}
                <div className="flex justify-center">
                  <button
                    onClick={() => togglePref(evt.key, 'desktop')}
                    className={`w-9 h-5 rounded-full transition-colors relative ${p.desktop ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${p.desktop ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
                {/* Email toggle */}
                <div className="flex justify-center">
                  <button
                    onClick={() => togglePref(evt.key, 'email')}
                    className={`w-9 h-5 rounded-full transition-colors relative ${p.email ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${p.email ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Aparência ───────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-3 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <Palette size={15} className="text-muted-foreground" />
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Aparência</h2>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[14px] font-semibold">Tema da Interface</p>
            <p className="text-[12px] text-muted-foreground">Alterne entre modo escuro e modo claro</p>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* ─── Desktop notifications toggle ────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-3 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <Monitor size={15} className="text-muted-foreground" />
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Notificações do Navegador</h2>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[14px] font-semibold">Notificações Desktop</p>
            <p className="text-[12px] text-muted-foreground">Receba alertas mesmo quando o navegador não estiver em foco</p>
          </div>
          <button
            onClick={handleToggleDesktopNotif}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
              desktopEnabled && permissionState === 'granted' ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
            disabled={permissionState === 'denied'}
          >
            <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              desktopEnabled && permissionState === 'granted' ? 'translate-x-5' : ''
            }`} />
          </button>
        </div>
        {permissionState === 'denied' && (
          <p className="text-[12px] text-amber-500 mt-2">Permissão bloqueada pelo navegador. Habilite nas configurações do navegador para este site.</p>
        )}
        {permissionState === 'default' && (
          <p className="text-[12px] text-muted-foreground mt-2">Clique no toggle para solicitar permissão ao navegador.</p>
        )}

        {/* Web Push toggle */}
        {pushSupported && (
          <>
            <div className="h-px bg-border my-4" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[14px] font-semibold">Notificações Push (aba fechada)</p>
                <p className="text-[12px] text-muted-foreground">
                  Receba alertas mesmo quando o navegador estiver fechado ou minimizado
                </p>
              </div>
              <button
                onClick={async () => {
                  setPushLoading(true);
                  if (pushEnabled) {
                    const ok = await unsubscribeFromPush();
                    if (ok) setPushEnabled(false);
                  } else {
                    const ok = await subscribeToPush();
                    if (ok) setPushEnabled(true);
                  }
                  setPushLoading(false);
                }}
                disabled={pushLoading}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                  pushEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                } ${pushLoading ? 'opacity-50' : ''}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  pushEnabled ? 'translate-x-5' : ''
                }`} />
              </button>
            </div>
            {pushEnabled && (
              <p className="text-[12px] text-emerald-400 mt-1">✓ Push ativo neste dispositivo</p>
            )}
          </>
        )}
      </div>

      {/* ─── Sound selector ──────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-3 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <Volume2 size={15} className="text-muted-foreground" />
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Som de Notificação</h2>
        </div>
        <div className="grid gap-2.5">
          {NOTIFICATION_SOUNDS.map((sound) => {
            const isActive = selected === sound.id;
            return (
              <div
                key={sound.id}
                onClick={() => handleSelectSound(sound.id)}
                className={`flex items-center justify-between px-4 py-3.5 rounded-xl border cursor-pointer transition-all ${
                  isActive ? 'border-primary/60 bg-primary/10' : 'border-border bg-muted/20 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                    isActive ? 'border-primary' : 'border-muted-foreground/40'
                  }`}>
                    {isActive && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div>
                    <p className={`font-semibold text-[14px] ${isActive ? 'text-primary' : 'text-foreground'}`}>{sound.label}</p>
                    <p className={`text-[12px] ${isActive ? 'text-primary/70' : 'text-muted-foreground'}`}>{sound.description}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); playNotificationSound(sound.id); }}
                  title="Ouvir prévia"
                  className={`p-2 rounded-lg transition-colors ${
                    isActive ? 'bg-primary/20 hover:bg-primary/30 text-primary' : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Play size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Info box ────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="text-sm font-semibold mb-3">Como funciona</h3>
        <ul className="space-y-2.5 text-[13px] text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5 shrink-0">•</span>
            <span>As preferências são salvas no servidor e sincronizam entre todos os seus dispositivos.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5 shrink-0">•</span>
            <span>O modo "Não Perturbe" pausa sons e notificações desktop, mas os badges de não-lidos continuam atualizando.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5 shrink-0">•</span>
            <span>Desative o som de "Novas mensagens" para trabalhar em silêncio sem perder os badges visuais.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
