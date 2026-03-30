'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Shield, Check, X, ChevronDown, Loader2, Users } from 'lucide-react';
import api from '@/lib/api';

// ─── Matriz de permissões ─────────────────────────────────────────────────────

const ROLES = ['ADMIN', 'ADVOGADO', 'OPERADOR', 'ESTAGIARIO'] as const;
type Role = typeof ROLES[number];

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  ADVOGADO: 'Advogado',
  OPERADOR: 'Operador',
  ESTAGIARIO: 'Estagiário',
};

const ROLE_COLORS: Record<Role, string> = {
  ADMIN: 'bg-red-500/10 text-red-400 border-red-500/20',
  ADVOGADO: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  OPERADOR: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  ESTAGIARIO: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};

type Permission = 'full' | 'partial' | 'none';

interface MatrixRow {
  label: string;
  description: string;
  permissions: Record<Role, Permission>;
}

const MATRIX: MatrixRow[] = [
  {
    label: 'Dashboard',
    description: 'Painel com métricas e visão geral',
    permissions: { ADMIN: 'full', ADVOGADO: 'full', OPERADOR: 'none', ESTAGIARIO: 'none' },
  },
  {
    label: 'Inbox — Leads',
    description: 'Conversas com leads (não clientes)',
    permissions: { ADMIN: 'full', ADVOGADO: 'none', OPERADOR: 'partial', ESTAGIARIO: 'partial' },
  },
  {
    label: 'Inbox — Clientes',
    description: 'Conversas com clientes convertidos',
    permissions: { ADMIN: 'full', ADVOGADO: 'partial', OPERADOR: 'partial', ESTAGIARIO: 'none' },
  },
  {
    label: 'Leads & CRM',
    description: 'Gestão do funil comercial',
    permissions: { ADMIN: 'full', ADVOGADO: 'partial', OPERADOR: 'partial', ESTAGIARIO: 'none' },
  },
  {
    label: 'Contatos',
    description: 'Lista de todos os contatos',
    permissions: { ADMIN: 'full', ADVOGADO: 'partial', OPERADOR: 'partial', ESTAGIARIO: 'none' },
  },
  {
    label: 'Tarefas',
    description: 'Gerenciamento de tarefas',
    permissions: { ADMIN: 'full', ADVOGADO: 'partial', OPERADOR: 'partial', ESTAGIARIO: 'partial' },
  },
  {
    label: 'Agenda',
    description: 'Calendário e eventos',
    permissions: { ADMIN: 'full', ADVOGADO: 'partial', OPERADOR: 'none', ESTAGIARIO: 'partial' },
  },
  {
    label: 'Follow-up IA',
    description: 'Sequências automáticas de mensagens',
    permissions: { ADMIN: 'full', ADVOGADO: 'full', OPERADOR: 'partial', ESTAGIARIO: 'none' },
  },
  {
    label: 'Triagem e Peticionamento',
    description: 'Área jurídica de triagem',
    permissions: { ADMIN: 'full', ADVOGADO: 'full', OPERADOR: 'none', ESTAGIARIO: 'partial' },
  },
  {
    label: 'Processos',
    description: 'Gestão de processos judiciais',
    permissions: { ADMIN: 'full', ADVOGADO: 'full', OPERADOR: 'none', ESTAGIARIO: 'partial' },
  },
  {
    label: 'Processos — criar/editar',
    description: 'Cadastrar e alterar processos',
    permissions: { ADMIN: 'full', ADVOGADO: 'full', OPERADOR: 'none', ESTAGIARIO: 'none' },
  },
  {
    label: 'DJEN — Publicações',
    description: 'Diário da Justiça Eletrônico Nacional',
    permissions: { ADMIN: 'full', ADVOGADO: 'full', OPERADOR: 'none', ESTAGIARIO: 'partial' },
  },
  {
    label: 'Analytics',
    description: 'Relatórios e métricas avançadas',
    permissions: { ADMIN: 'full', ADVOGADO: 'full', OPERADOR: 'none', ESTAGIARIO: 'none' },
  },
  {
    label: 'Configurações',
    description: 'Ajustes gerais do sistema',
    permissions: { ADMIN: 'full', ADVOGADO: 'none', OPERADOR: 'none', ESTAGIARIO: 'none' },
  },
  {
    label: 'Usuários & Perfis',
    description: 'Criar e editar usuários',
    permissions: { ADMIN: 'full', ADVOGADO: 'none', OPERADOR: 'none', ESTAGIARIO: 'none' },
  },
  {
    label: 'Automações',
    description: 'Regras automáticas do sistema',
    permissions: { ADMIN: 'full', ADVOGADO: 'none', OPERADOR: 'none', ESTAGIARIO: 'none' },
  },
];

// ─── Componente ───────────────────────────────────────────────────────────────

function PermIcon({ p }: { p: Permission }) {
  if (p === 'full') return <Check size={14} className="text-emerald-400" />;
  if (p === 'partial') return <span className="text-amber-400 text-[10px] font-bold leading-none">parcial</span>;
  return <X size={14} className="text-muted-foreground/40" />;
}

export default function PermissionsSettingsPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'matrix' | 'users'>('matrix');

  // Abre dropdown via portal com posição calculada pelo botão
  const openDropdownAt = (userId: string, btnEl: HTMLElement) => {
    if (openDropdown === userId) {
      setOpenDropdown(null);
      setDropdownPos(null);
      return;
    }
    const rect = btnEl.getBoundingClientRect();
    const MENU_H = 4 * 36 + 8; // 4 opções × 36px + padding
    const top = rect.bottom + MENU_H > window.innerHeight
      ? rect.top - MENU_H          // abre para cima
      : rect.bottom + 4;           // abre para baixo
    setDropdownPos({ top, left: rect.right - 176, width: rect.width });
    setOpenDropdown(userId);
  };

  useEffect(() => {
    api.get('/users')
      .then(r => {
        const data = Array.isArray(r.data) ? r.data : [];
        setUsers(data);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoadingUsers(false));
  }, []);

  const changeRole = async (userId: string, newRole: Role) => {
    setUpdatingId(userId);
    setOpenDropdown(null);
    try {
      await api.patch(`/users/${userId}`, { role: newRole });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch {}
    setUpdatingId(null);
  };

  // Normaliza o role para comparação (case-insensitive)
  const normalizeRole = (r: string | null | undefined): Role | null => {
    if (!r) return null;
    const upper = r.toUpperCase() as Role;
    return ROLES.includes(upper) ? upper : null;
  };

  const usersByRole = ROLES.map(role => ({
    role,
    users: users.filter(u => normalizeRole(u.role) === role),
  }));

  // Usuários com role desconhecida/nula ficam visíveis no grupo "Sem perfil"
  const orphanUsers = users.filter(u => normalizeRole(u.role) === null);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      <header className="px-8 pt-8 pb-0 shrink-0">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Permissões</h1>
        <p className="text-[13px] text-muted-foreground mt-1">Controle de acesso por perfil de usuário.</p>

        {/* Tabs */}
        <div className="flex gap-1 mt-5 border-b border-border">
          {(['matrix', 'users'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'matrix' ? 'Matriz de Acesso' : 'Usuários por Role'}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">

        {/* ─── Tab: Matriz ───────────────────────────────────── */}
        {activeTab === 'matrix' && (
          <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-5 py-3.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider w-64">
                      Funcionalidade
                    </th>
                    {ROLES.map(role => (
                      <th key={role} className="px-4 py-3.5 text-center w-32">
                        <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${ROLE_COLORS[role]}`}>
                          {ROLE_LABELS[role]}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MATRIX.map((row, i) => (
                    <tr key={row.label} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/5'}`}>
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-foreground text-[13px]">{row.label}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{row.description}</div>
                      </td>
                      {ROLES.map(role => (
                        <td key={role} className="px-4 py-3.5 text-center">
                          <div className="flex items-center justify-center h-5">
                            <PermIcon p={row.permissions[role]} />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legenda */}
            <div className="px-5 py-3.5 border-t border-border bg-muted/10 flex items-center gap-6 flex-wrap">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Legenda:</span>
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Check size={13} className="text-emerald-400" /> Acesso total
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <span className="text-amber-400 text-[10px] font-bold">parcial</span> Acesso limitado (próprios registros)
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <X size={13} className="text-muted-foreground/40" /> Sem acesso
              </div>
            </div>
          </div>
        )}

        {/* ─── Tab: Usuários por Role ────────────────────────── */}
        {activeTab === 'users' && (
          <div className="space-y-5">
            {loadingUsers ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Shield size={32} className="text-destructive/50" />
                <p className="text-[13px] text-muted-foreground">Erro ao carregar usuários. Verifique sua conexão e recarregue.</p>
              </div>
            ) : (
              <>
              {usersByRole.map(({ role, users: roleUsers }) => (
                <div key={role} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                  <div className={`px-5 py-3.5 border-b border-border flex items-center gap-3`}>
                    <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${ROLE_COLORS[role]}`}>
                      {ROLE_LABELS[role]}
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {roleUsers.length} {roleUsers.length === 1 ? 'usuário' : 'usuários'}
                    </span>
                  </div>

                  {roleUsers.length === 0 ? (
                    <div className="px-5 py-4 text-[13px] text-muted-foreground flex items-center gap-2">
                      <Users size={14} /> Nenhum usuário neste perfil
                    </div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {roleUsers.map(user => (
                        <div key={user.id} className="px-5 py-3 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 text-[13px] font-bold text-muted-foreground">
                              {(user.name || user.email || '?')[0].toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-foreground truncate">{user.name || '(sem nome)'}</div>
                              <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
                            </div>
                          </div>

                          {/* Role selector */}
                          <div className="relative shrink-0">
                            <button
                              onClick={(e) => openDropdownAt(user.id, e.currentTarget)}
                              disabled={updatingId === user.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-accent text-[12px] font-semibold text-foreground transition-colors disabled:opacity-50"
                            >
                              {updatingId === user.id
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Shield size={12} className="text-muted-foreground" />
                              }
                              {ROLE_LABELS[user.role as Role] || user.role}
                              <ChevronDown size={12} className="text-muted-foreground" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Grupo de usuários com role inválida/nula */}
              {orphanUsers.length > 0 && (
                <div className="bg-card rounded-2xl border border-destructive/30 shadow-sm overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-border flex items-center gap-3">
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold border bg-destructive/10 text-destructive border-destructive/20">
                      Sem perfil definido
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {orphanUsers.length} {orphanUsers.length === 1 ? 'usuário' : 'usuários'} com role inválida ou nula
                    </span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {orphanUsers.map(user => (
                      <div key={user.id} className="px-5 py-3 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 text-[13px] font-bold text-muted-foreground">
                            {(user.name || user.email || '?')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-foreground truncate">{user.name || '(sem nome)'}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
                            {user.role && (
                              <div className="text-[10px] text-destructive/70 font-mono mt-0.5">role no banco: "{user.role}"</div>
                            )}
                          </div>
                        </div>
                        {/* Permite corrigir o role direto daqui */}
                        <div className="relative shrink-0">
                          <button
                            onClick={(e) => openDropdownAt(user.id, e.currentTarget)}
                            disabled={updatingId === user.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/40 bg-background hover:bg-accent text-[12px] font-semibold text-destructive transition-colors disabled:opacity-50"
                          >
                            {updatingId === user.id
                              ? <Loader2 size={12} className="animate-spin" />
                              : <Shield size={12} />
                            }
                            Atribuir role
                            <ChevronDown size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── Portal: dropdown de role (escapa overflow dos pais) ─── */}
      {openDropdown && dropdownPos && createPortal(
        <>
          {/* overlay transparente fecha ao clicar fora */}
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => { setOpenDropdown(null); setDropdownPos(null); }}
          />
          <div
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: 176,
              zIndex: 9999,
            }}
            className="bg-card border border-border rounded-xl shadow-xl py-1 overflow-hidden"
          >
            {ROLES.map(r => {
              const u = users.find(u => u.id === openDropdown);
              const isActive = u ? normalizeRole(u.role) === r : false;
              return (
                <button
                  key={r}
                  onClick={() => { changeRole(openDropdown, r); setDropdownPos(null); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-semibold transition-colors hover:bg-accent ${isActive ? 'text-primary bg-primary/5' : 'text-foreground'}`}
                >
                  <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-primary' : 'bg-muted'}`} />
                  {ROLE_LABELS[r]}
                  {isActive && <Check size={12} className="ml-auto text-primary" />}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
