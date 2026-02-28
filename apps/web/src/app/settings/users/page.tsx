'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, X, UserCog } from 'lucide-react';
import api from '@/lib/api';

const ROLES = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'ADVOGADO', label: 'Advogado' },
  { value: 'ESTAGIARIO', label: 'Estagiário' },
  { value: 'COMERCIAL', label: 'Comercial' },
  { value: 'FINANCEIRO', label: 'Financeiro' },
];

const roleBadgeColors: Record<string, string> = {
  ADMIN: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  ADVOGADO: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ESTAGIARIO: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  COMERCIAL: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  FINANCEIRO: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
};

interface UserForm {
  name: string;
  email: string;
  password: string;
  role: string;
}

const emptyForm: UserForm = { name: '', email: '', password: '', role: 'ADVOGADO' };

export default function UsersSettingsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetchUsers();
  }, [router]);

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (e: any) {
      if (e.response?.status === 401 && process.env.NODE_ENV !== 'development') {
        localStorage.removeItem('token');
        router.push('/login');
      }
      if (e.response?.status === 403) {
        setError('Você não tem permissão para acessar esta página.');
      }
      if (!e.response) {
         console.warn('Backend offline - Mock Mode ativado (sem usuários reais)');
      }
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
    setShowModal(true);
  };

  const openEdit = (user: any) => {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email, password: '', role: user.role });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (editingId) {
        const payload: any = { name: form.name, email: form.email, role: form.role };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${editingId}`, payload);
      } else {
        if (!form.password) {
          setError('Senha é obrigatória para novos usuários.');
          setLoading(false);
          return;
        }
        await api.post('/users', form);
      }
      setShowModal(false);
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Erro ao salvar usuário.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja remover o usuário "${name}"?`)) return;
    try {
      await api.delete(`/users/${id}`);
      fetchUsers();
    } catch (e: any) {
      alert(e.response?.data?.message || 'Erro ao remover usuário.');
    }
  };

  return (
    <div className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
      <header className="px-8 mb-6 shrink-0 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Usuários & Perfis</h1>
          <p className="text-[13px] text-muted-foreground mt-1">Gerencie os usuários do sistema e seus perfis de acesso.</p>
        </div>
        <button
          onClick={openCreate}
          className="px-5 py-2.5 btn-primary font-medium rounded-xl flex items-center shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="w-5 h-5 mr-2" />
          Novo Usuário
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {error && !showModal && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-[13px] font-medium">
            {error}
          </div>
        )}

        {/* Tabela de Usuários */}
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          {users.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground opacity-40">
              <UserCog className="w-12 h-12 mb-4 stroke-[1.5]" />
              <p className="text-sm font-medium">Nenhum usuário cadastrado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-foreground/[0.02] border-b border-border">
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Nome</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Email</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Perfil</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Criado em</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/[0.04]">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-foreground/[0.02] transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold mr-3 text-xs border border-primary/20 shadow-sm">
                            {user.name?.charAt(0)?.toUpperCase()}
                          </div>
                          <span className="text-[14px] font-semibold text-foreground tracking-tight">{user.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[13px] text-muted-foreground">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${roleBadgeColors[user.role] || 'bg-muted text-muted-foreground border border-border'}`}>
                          {ROLES.find(r => r.value === user.role)?.label || user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-[13px] text-muted-foreground opacity-70">
                        {new Date(user.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(user)}
                            className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(user.id, user.name)}
                            className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
                            title="Remover"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal Criar/Editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-5 border-b border-border bg-foreground/[0.02]">
              <h2 className="text-lg font-bold text-foreground tracking-tight">
                {editingId ? 'Editar Usuário' : 'Novo Usuário'}
              </h2>
              <button 
                onClick={() => setShowModal(false)} 
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-all rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-[13px] font-medium">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider ml-1">Nome</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-border rounded-xl bg-foreground/[0.03] text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                  placeholder="Nome completo"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider ml-1">Email</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full px-4 py-2.5 border border-border rounded-xl bg-foreground/[0.03] text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                  placeholder="email@exemplo.com"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider ml-1">
                  Senha {editingId && <span className="text-[11px] font-normal lowercase opacity-60">(deixe em branco para manter)</span>}
                </label>
                <input
                  type="password"
                  required={!editingId}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full px-4 py-2.5 border border-border rounded-xl bg-foreground/[0.03] text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider ml-1">Perfil</label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="w-full px-4 py-2.5 border border-border rounded-xl bg-foreground/[0.03] text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 text-muted-foreground font-semibold hover:bg-foreground/[0.05] hover:text-foreground rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2.5 btn-primary disabled:opacity-50 font-bold rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-primary/20"
                >
                  {loading ? 'Salvando...' : editingId ? 'Salvar' : 'Criar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
