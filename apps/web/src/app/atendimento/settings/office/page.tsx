'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, Briefcase, Trash2, Plus, Save, X, Star, Mail, Users } from 'lucide-react';
import api from '@/lib/api';

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

interface ScheduleSlot {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
  lunch_enabled: boolean;
  lunch_start: string;
  lunch_end: string;
}

interface AppType {
  id: string;
  name: string;
  duration: number;
  color: string | null;
  active: boolean;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
  recurring_yearly: boolean;
}

interface UserOption {
  id: string;
  name: string;
  role: string;
}

export default function OfficeSettingsPage() {
  // ─── State ─────────────────────────────────────────
  const [userId, setUserId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(
    Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i,
      start_time: i >= 1 && i <= 5 ? '08:00' : '',
      end_time: i >= 1 && i <= 5 ? '18:00' : '',
      enabled: i >= 1 && i <= 5,
      lunch_enabled: false,
      lunch_start: '12:00',
      lunch_end: '13:00',
    })),
  );
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const [appTypes, setAppTypes] = useState<AppType[]>([]);
  const [newType, setNewType] = useState({ name: '', duration: 30, color: '#8b5cf6' });
  const [showNewType, setShowNewType] = useState(false);

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '', recurring_yearly: false });
  const [showNewHoliday, setShowNewHoliday] = useState(false);

  const [smtpConfig, setSmtpConfig] = useState({
    SMTP_HOST: '',
    SMTP_PORT: '587',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: '',
  });
  const [smtpSaved, setSmtpSaved] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);

  // ─── Load Data ─────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.sub) {
        const role = payload?.role || '';
        const isAdminUser = role === 'ADMIN';
        setUserId(payload.sub);
        setIsAdmin(isAdminUser);
        setSelectedUserId(payload.sub);
        loadSchedule(payload.sub);
        if (isAdminUser) loadUsers();
      }
    } catch {}
    loadAppTypes();
    loadHolidays();
    loadSmtpConfig();
  }, []);

  const loadUsers = async () => {
    try {
      const res = await api.get('/users?limit=100');
      const data = (res.data?.data || res.data?.users || res.data || []) as UserOption[];
      // Mostrar apenas advogados e admins (não atendentes comerciais)
      const lawyers = data
        .map((u: any) => ({ id: u.id, name: u.name, role: u.role }))
        .filter((u) => u.role === 'ADVOGADO' || u.role === 'ADMIN');
      setUsers(lawyers);
    } catch {}
  };

  const handleUserChange = (uid: string) => {
    setSelectedUserId(uid);
    loadSchedule(uid);
  };

  const loadSchedule = async (uid: string) => {
    try {
      const res = await api.get(`/calendar/schedule/${uid}`);
      const data = res.data as any[];
      if (data.length > 0) {
        setSchedule(
          Array.from({ length: 7 }, (_, i) => {
            const existing = data.find((d: any) => d.day_of_week === i);
            return existing
              ? {
                  day_of_week: i,
                  start_time: existing.start_time,
                  end_time: existing.end_time,
                  enabled: true,
                  lunch_enabled: !!(existing.lunch_start && existing.lunch_end),
                  lunch_start: existing.lunch_start || '12:00',
                  lunch_end: existing.lunch_end || '13:00',
                }
              : { day_of_week: i, start_time: '', end_time: '', enabled: false, lunch_enabled: false, lunch_start: '12:00', lunch_end: '13:00' };
          }),
        );
      }
    } catch {}
  };

  const loadAppTypes = async () => {
    try {
      const res = await api.get('/calendar/appointment-types');
      setAppTypes(res.data || []);
    } catch {}
  };

  const loadHolidays = async () => {
    try {
      const res = await api.get('/calendar/holidays');
      setHolidays((res.data || []).map((h: any) => ({
        ...h,
        date: h.date.split('T')[0],
      })));
    } catch {}
  };

  const loadSmtpConfig = async () => {
    try {
      const res = await api.get('/settings');
      const settings = res.data as any[];
      const cfg = { ...smtpConfig };
      for (const s of settings) {
        if (s.key in cfg) (cfg as any)[s.key] = s.value;
      }
      setSmtpConfig(cfg);
    } catch {}
  };

  // ─── Handlers ──────────────────────────────────────

  const saveSchedule = async () => {
    const targetId = selectedUserId || userId;
    if (!targetId) return;
    setScheduleSaving(true);
    try {
      const slots = schedule
        .filter((s) => s.enabled && s.start_time && s.end_time)
        .map((s) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          lunch_start: s.lunch_enabled && s.lunch_start ? s.lunch_start : null,
          lunch_end: s.lunch_enabled && s.lunch_end ? s.lunch_end : null,
        }));
      await api.put(`/calendar/schedule/${targetId}`, { slots });
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 2000);
    } catch {}
    setScheduleSaving(false);
  };

  const createAppType = async () => {
    if (!newType.name.trim()) return;
    try {
      await api.post('/calendar/appointment-types', newType);
      setNewType({ name: '', duration: 30, color: '#8b5cf6' });
      setShowNewType(false);
      loadAppTypes();
    } catch {}
  };

  const toggleAppType = async (t: AppType) => {
    try {
      await api.patch(`/calendar/appointment-types/${t.id}`, { active: !t.active });
      loadAppTypes();
    } catch {}
  };

  const deleteAppType = async (id: string) => {
    try {
      await api.delete(`/calendar/appointment-types/${id}`);
      loadAppTypes();
    } catch {}
  };

  const createHoliday = async () => {
    if (!newHoliday.date || !newHoliday.name.trim()) return;
    try {
      await api.post('/calendar/holidays', newHoliday);
      setNewHoliday({ date: '', name: '', recurring_yearly: false });
      setShowNewHoliday(false);
      loadHolidays();
    } catch {}
  };

  const deleteHoliday = async (id: string) => {
    try {
      await api.delete(`/calendar/holidays/${id}`);
      loadHolidays();
    } catch {}
  };

  const saveSmtp = async () => {
    setSmtpSaving(true);
    try {
      for (const [key, value] of Object.entries(smtpConfig)) {
        await api.put('/settings', { key, value });
      }
      setSmtpSaved(true);
      setTimeout(() => setSmtpSaved(false), 2000);
    } catch {}
    setSmtpSaving(false);
  };

  // ─── Render ────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
      <header className="px-8 mb-6 shrink-0">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Agenda & Escritório</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Configure horários de trabalho, tipos de atendimento, feriados e email de lembretes.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6">
        {/* ═══════ Seção 1: Horários de Trabalho ═══════ */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-primary" />
              <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Horários de Trabalho
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {scheduleSaved && (
                <span className="text-xs text-primary font-semibold animate-fade-in">✓ Salvo</span>
              )}
              <button
                onClick={saveSchedule}
                disabled={scheduleSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Save size={12} />
                {scheduleSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>

          {/* Seletor de advogado — visível apenas para ADMIN */}
          {isAdmin && users.length > 0 && (
            <div className="flex items-center gap-2 mb-5 p-3 rounded-xl bg-muted/20 border border-border/50">
              <Users size={14} className="text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Configurando horários de:</span>
              <select
                value={selectedUserId}
                onChange={(e) => handleUserChange(e.target.value)}
                className="flex-1 px-2 py-1 text-sm bg-muted/30 border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} {u.id === userId ? '(você)' : `— ${u.role}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            {schedule.map((slot, idx) => (
              <div key={slot.day_of_week} className="flex flex-col gap-1">
                {/* Linha principal: dia + horário de trabalho */}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 min-w-[130px]">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={(e) => {
                        const updated = [...schedule];
                        updated[idx] = { ...slot, enabled: e.target.checked };
                        setSchedule(updated);
                      }}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className={`text-sm font-medium ${slot.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {DAY_NAMES[slot.day_of_week]}
                    </span>
                  </label>
                  {slot.enabled ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Horário de trabalho */}
                      <input
                        type="time"
                        value={slot.start_time}
                        onChange={(e) => {
                          const updated = [...schedule];
                          updated[idx] = { ...slot, start_time: e.target.value };
                          setSchedule(updated);
                        }}
                        className="px-2 py-1.5 text-sm bg-muted/30 border border-border rounded-lg text-foreground"
                      />
                      <span className="text-muted-foreground text-xs">até</span>
                      <input
                        type="time"
                        value={slot.end_time}
                        onChange={(e) => {
                          const updated = [...schedule];
                          updated[idx] = { ...slot, end_time: e.target.value };
                          setSchedule(updated);
                        }}
                        className="px-2 py-1.5 text-sm bg-muted/30 border border-border rounded-lg text-foreground"
                      />
                      {/* Separador + toggle almoço */}
                      <span className="text-border/60 text-sm select-none">|</span>
                      <label className="flex items-center gap-1.5 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={slot.lunch_enabled}
                          onChange={(e) => {
                            const updated = [...schedule];
                            updated[idx] = { ...slot, lunch_enabled: e.target.checked };
                            setSchedule(updated);
                          }}
                          className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary"
                        />
                        <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                          ☕ Almoço
                        </span>
                      </label>
                      {/* Horários de almoço (só se habilitado) */}
                      {slot.lunch_enabled && (
                        <>
                          <input
                            type="time"
                            value={slot.lunch_start}
                            onChange={(e) => {
                              const updated = [...schedule];
                              updated[idx] = { ...slot, lunch_start: e.target.value };
                              setSchedule(updated);
                            }}
                            className="px-2 py-1.5 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg text-foreground"
                          />
                          <span className="text-muted-foreground text-xs">até</span>
                          <input
                            type="time"
                            value={slot.lunch_end}
                            onChange={(e) => {
                              const updated = [...schedule];
                              updated[idx] = { ...slot, lunch_end: e.target.value };
                              setSchedule(updated);
                            }}
                            className="px-2 py-1.5 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg text-foreground"
                          />
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Não trabalha</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══════ Seção 2: Tipos de Atendimento ═══════ */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Briefcase size={16} className="text-primary" />
              <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Tipos de Atendimento
              </h2>
            </div>
            <button
              onClick={() => setShowNewType(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
            >
              <Plus size={12} /> Novo Tipo
            </button>
          </div>

          <div className="space-y-2">
            {appTypes.map((t) => (
              <div
                key={t.id}
                className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                  t.active ? 'border-border bg-muted/20' : 'border-border/50 bg-muted/5 opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: t.color || '#8b5cf6' }}
                  />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground">{t.duration} min</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleAppType(t)}
                    className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md transition-colors ${
                      t.active
                        ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                        : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {t.active ? 'Ativo' : 'Inativo'}
                  </button>
                  <button
                    onClick={() => deleteAppType(t.id)}
                    className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            {appTypes.length === 0 && !showNewType && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum tipo de atendimento cadastrado.
              </p>
            )}

            {showNewType && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5">
                <input
                  type="color"
                  value={newType.color}
                  onChange={(e) => setNewType({ ...newType, color: e.target.value })}
                  className="w-8 h-8 rounded border-none cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  placeholder="Nome do tipo..."
                  value={newType.name}
                  onChange={(e) => setNewType({ ...newType, name: e.target.value })}
                  className="flex-1 px-3 py-1.5 text-sm bg-muted/30 border border-border rounded-lg text-foreground placeholder:text-muted-foreground"
                  autoFocus
                />
                <input
                  type="number"
                  value={newType.duration}
                  onChange={(e) => setNewType({ ...newType, duration: parseInt(e.target.value) || 30 })}
                  className="w-16 px-2 py-1.5 text-sm bg-muted/30 border border-border rounded-lg text-foreground text-center"
                  min={5}
                  max={480}
                />
                <span className="text-xs text-muted-foreground">min</span>
                <button
                  onClick={createAppType}
                  className="p-1.5 text-primary hover:bg-primary/20 rounded-lg transition-colors"
                >
                  <Save size={14} />
                </button>
                <button
                  onClick={() => setShowNewType(false)}
                  className="p-1.5 text-muted-foreground hover:bg-muted/50 rounded-lg transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ═══════ Seção 3: Feriados ═══════ */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Star size={16} className="text-primary" />
              <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Feriados & Dias Bloqueados
              </h2>
            </div>
            <button
              onClick={() => setShowNewHoliday(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
            >
              <Plus size={12} /> Feriado
            </button>
          </div>

          <div className="space-y-2">
            {holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-muted/20">
                <div className="flex items-center gap-3">
                  <Calendar size={14} className="text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{h.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(h.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: h.recurring_yearly ? undefined : 'numeric' })}
                      {h.recurring_yearly && (
                        <span className="ml-1.5 text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">Anual</span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => deleteHoliday(h.id)}
                  className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {holidays.length === 0 && !showNewHoliday && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum feriado cadastrado. Dias sem feriado ficam disponíveis na agenda.
              </p>
            )}

            {showNewHoliday && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5">
                <input
                  type="date"
                  value={newHoliday.date}
                  onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
                  className="px-2 py-1.5 text-sm bg-muted/30 border border-border rounded-lg text-foreground"
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="Nome do feriado..."
                  value={newHoliday.name}
                  onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                  className="flex-1 px-3 py-1.5 text-sm bg-muted/30 border border-border rounded-lg text-foreground placeholder:text-muted-foreground"
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={newHoliday.recurring_yearly}
                    onChange={(e) => setNewHoliday({ ...newHoliday, recurring_yearly: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary"
                  />
                  Anual
                </label>
                <button onClick={createHoliday} className="p-1.5 text-primary hover:bg-primary/20 rounded-lg transition-colors">
                  <Save size={14} />
                </button>
                <button onClick={() => setShowNewHoliday(false)} className="p-1.5 text-muted-foreground hover:bg-muted/50 rounded-lg transition-colors">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ═══════ Seção 4: Config Email (SMTP) ═══════ */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Mail size={16} className="text-primary" />
              <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Email para Lembretes
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {smtpSaved && (
                <span className="text-xs text-primary font-semibold animate-fade-in">✓ Salvo</span>
              )}
              <button
                onClick={saveSmtp}
                disabled={smtpSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Save size={12} />
                {smtpSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Servidor SMTP</label>
              <input
                type="text"
                placeholder="smtp.gmail.com"
                value={smtpConfig.SMTP_HOST}
                onChange={(e) => setSmtpConfig({ ...smtpConfig, SMTP_HOST: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-muted/30 border border-border rounded-lg text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Porta</label>
              <input
                type="text"
                placeholder="587"
                value={smtpConfig.SMTP_PORT}
                onChange={(e) => setSmtpConfig({ ...smtpConfig, SMTP_PORT: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-muted/30 border border-border rounded-lg text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Usuário</label>
              <input
                type="text"
                placeholder="email@example.com"
                value={smtpConfig.SMTP_USER}
                onChange={(e) => setSmtpConfig({ ...smtpConfig, SMTP_USER: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-muted/30 border border-border rounded-lg text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Senha</label>
              <input
                type="password"
                placeholder="••••••••"
                value={smtpConfig.SMTP_PASS}
                onChange={(e) => setSmtpConfig({ ...smtpConfig, SMTP_PASS: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-muted/30 border border-border rounded-lg text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Email remetente</label>
              <input
                type="email"
                placeholder="noreply@escritorio.com.br"
                value={smtpConfig.SMTP_FROM}
                onChange={(e) => setSmtpConfig({ ...smtpConfig, SMTP_FROM: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-muted/30 border border-border rounded-lg text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground mt-4">
            Configure o servidor SMTP para enviar lembretes de eventos por email.
            Usado quando o canal &quot;Email&quot; é selecionado nos lembretes de um evento.
          </p>
        </div>
      </div>
    </div>
  );
}
