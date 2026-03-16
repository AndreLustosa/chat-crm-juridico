'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, X, UserCog, Phone } from 'lucide-react';
import api from '@/lib/api';

const SPECIALTY_SUGGESTIONS = ['Trabalhista', 'Civil', 'Criminal', 'Tributário', 'Família', 'Empresarial', 'Previdenciário', 'Imobiliário', 'Consumidor'];

function roleBadge(role: string) {
  if (role === 'ADMIN') {
    return <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg border bg-red-900/30 text-red-300 border-red-800/30">Administrador</span>;
  }
  return <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg border bg-primary/10 text-primary border-primary/20">{role}</span>;
}

interface UserForm {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: string;
  inboxIds: string[];
  specialties: string[];
  supervisorIds: string[];
}

const emptyForm: UserForm = { name: '', email: '', phone: '', password: '', role: '', inboxIds: [], specialties: [], supervisorIds: [] };

export default function UsersSettingsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [sectors, setSectors] = useState<{ id: string; name: string }[]>([]);
  const [lawyers, setLawyers] = useState<{ id: string; name: string; specialties: string[] }[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [specialtyInput, setSpecialtyInput] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/atendimento/login');
      return;
    }
    fetchData();
  }, [router]);

  const fetchData = async () => {
    fetchUsers();
    fetchInboxes();
    fetchSectors();
    fetchLawyers();
  };

  const fetchInboxes = async () => {
    try {
      const res = await api.get('/inboxes');
      setInboxes(res.data);
    } catch (e) {
      console.error('Erro ao buscar inboxes:', e);
    }
  };

  const fetchSectors = async () => {
    try {
      const res = await api.get('/sectors');
      setSectors(res.data || []);
    } catch (e) {
      console.error('Erro ao buscar departamentos:', e);
    }
  };

  const fetchLawyers = async () => {
    try {
      const res = await api.get('/users/lawyers');
      setLawyers(res.data || []);
    } catch (e) {
      console.error('Erro ao buscar advogados:', e);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (e: any) {
      // 401 is handled globally by api.ts interceptor
      if (e.response?.status === 403) {
        setError('Você não tem permissão para acessar esta página.');
      }
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSpecialtyInput('');
    setError('');
    setShowModal(true);
  };

  const openEdit = (user: any) => {
    setEditingId(user.id);
    setForm({
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      password: '',
      role: user.role,
      inboxIds: user.inboxes?.map((i: any) => i.id) || [],
      specialties: user.specialties || [],
      supervisorIds: user.supervisors?.map((s: any) => s.id) || [],
    });
    setSpecialtyInput('');
    setError('');
    setShowModal(true);
  };

  const addSpecialty = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || form.specialties.includes(trimmed)) return;
    setForm(f => ({ ...f, specialties: [...f.specialties, trimmed] }));
    setSpecialtyInput('');
  };

  const removeSpecialty = (s: string) => {
    setForm(f => ({ ...f, specialties: f.specialties.filter(x => x !== s) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (editingId) {
        const payload: any = {
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          role: form.role,
          inboxIds: form.inboxIds,
          specialties: form.specialties,
        };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${editingId}`, payload);
        // Salvar vínculo de supervisores
        await api.patch(`/users/${editingId}/supervisors`, { lawyerIds: form.supervisorIds });
      } else {
        if (!form.password) {
          setError('Senha é obrigatória para novos usuários.');
          setLoading(false);
          return;
        }
        const res = await api.post('/users', form);
        // Salvar vínculo de supervisores para novo usuário
        if (form.supervisorIds.length > 0 && res.data?.id) {
          await api.patch(`/users/${res.data.id}/supervisors`, { lawyerIds: form.supervisorIds });
        }
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
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Telefone</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Inboxes (Chat)</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Especialidades</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Supervisores</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Criado em</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-muted-foreground uppercase tracking-wider text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/[0.04]">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-foreground/[0.02] transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs border border-primary/20 shadow-sm shrink-0">
                            {user.name?.charAt(0)?.toUpperCase()}
                          </div>
                          <div>
                            <span className="text-[14px] font-semibold text-foreground tracking-tight">{user.name}</span>
                            <div className="mt-0.5">{roleBadge(user.role)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[13px] text-muted-foreground">{user.email}</td>
                      <td className="px-6 py-4 text-[13px] text-muted-foreground">
                        {user.phone ? (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3 h-3 text-green-400" />
                            {user.phone}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground opacity-50">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {user.inboxes?.map((inbox: any) => (
                            <span key={inbox.id} className="px-2 py-0.5 bg-primary/5 text-primary text-[10px] font-bold rounded-lg border border-primary/10">
                              {inbox.name}
                            </span>
                          ))}
                          {!user.inboxes?.length && <span className="text-[10px] text-muted-foreground opacity-50">Nenhum</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {user.specialties?.map((s: string) => (
                            <span key={s} className="px-2 py-0.5 bg-violet-500/10 text-violet-400 text-[10px] font-bold rounded-lg border border-violet-500/20">
                              {s}
                            </span>
                          ))}
                          {!user.specialties?.length && <span className="text-[10px] text-muted-foreground opacity-50">—</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {user.supervisors?.map((s: any) => (
                            <span key={s.id} className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 text-[10px] font-bold rounded-lg border border-indigo-500/20">
                              {s.name}
                            </span>
                          ))}
                          {!user.supervisors?.length && <span className="text-[10px] text-muted-foreground opacity-50">—</span>}
                        </div>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200 dark">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-5 border-b border-border bg-foreground/[0.02] shrink-0">
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
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
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
                  className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
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
                  className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                  placeholder="email@exemplo.com"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider ml-1">Telefone (WhatsApp)</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                  placeholder="5582999999999"
                />
                <p className="text-[10px] text-muted-foreground opacity-70 ml-1">
                  Formato: código do país + DDD + número (ex: 5582999999999). Usado para lembretes via WhatsApp.
                </p>
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
                  className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider ml-1">Departamento</label>
                <select
                  required
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                >
                  <option value="" disabled className="bg-card text-muted-foreground">Selecione um departamento...</option>
                  <option value="ADMIN" className="bg-card text-foreground">🛡️ Administrador</option>
                  <option value="Advogados" className="bg-card text-foreground">⚖️ Advogados</option>
                  <option value="Atendente Comercial" className="bg-card text-foreground">💼 Atendente Comercial</option>
                  <option value="Estagiário" className="bg-card text-foreground">🎓 Estagiário</option>
                  {(() => {
                    // normaliza para singular lowercase: "Estagiários" → "estagiário", "Advogados" → "advogado"
                    const norm = (s: string) => { const l = s.toLowerCase(); return l.endsWith('s') ? l.slice(0, -1) : l; };
                    const FIXED = new Set(['advogados', 'atendente comercial', 'estagiário'].map(norm));
                    return sectors.filter(s => !FIXED.has(norm(s.name))).map(s => (
                      <option key={s.id} value={s.name} className="bg-card text-foreground">{s.name}</option>
                    ));
                  })()}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider ml-1">Setores (Acesso ao Chat)</label>
                <div className="grid grid-cols-2 gap-2 p-3 border border-border rounded-xl bg-background/50">
                  {inboxes.map(inbox => (
                    <label key={inbox.id} className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox"
                        checked={form.inboxIds.includes(inbox.id)}
                        onChange={(e) => {
                          const ids = e.target.checked 
                            ? [...form.inboxIds, inbox.id]
                            : form.inboxIds.filter(id => id !== inbox.id);
                          setForm({ ...form, inboxIds: ids });
                        }}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
                      />
                      <span className="text-[13px] text-foreground group-hover:text-primary transition-colors">{inbox.name}</span>
                    </label>
                  ))}
                  {inboxes.length === 0 && (
                    <p className="col-span-2 text-[11px] text-muted-foreground italic text-center py-2">Nenhum setor cadastrado.</p>
                  )}
                </div>
              </div>
              {form.role && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider ml-1">
                    ⚖️ Especialidades Jurídicas
                  </label>
                  {form.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {form.specialties.map(s => (
                        <span key={s} className="inline-flex items-center gap-1 px-2.5 py-1 bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-bold rounded-lg">
                          {s}
                          <button type="button" onClick={() => removeSpecialty(s)} className="hover:text-red-400 transition-colors ml-0.5">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={specialtyInput}
                      onChange={e => setSpecialtyInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpecialty(specialtyInput); } }}
                      placeholder="Digite e pressione Enter..."
                      className="flex-1 px-3 py-2 border border-border rounded-xl bg-background text-foreground text-sm focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500/50 outline-none transition-all placeholder:text-muted-foreground/50"
                    />
                    <button
                      type="button"
                      onClick={() => addSpecialty(specialtyInput)}
                      className="px-3 py-2 bg-violet-500/10 border border-violet-500/20 text-violet-300 rounded-xl text-sm font-bold hover:bg-violet-500/20 transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {SPECIALTY_SUGGESTIONS.filter(s => !form.specialties.includes(s)).map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => addSpecialty(s)}
                        className="px-2 py-0.5 bg-muted/50 border border-border text-muted-foreground text-[10px] rounded-lg hover:bg-violet-500/10 hover:border-violet-500/20 hover:text-violet-300 transition-colors"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Supervisores (Advogados) */}
              {lawyers.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider ml-1">
                    👨‍⚖️ Supervisores (Advogados)
                  </label>
                  <div className="grid grid-cols-2 gap-2 p-3 border border-border rounded-xl bg-background/50">
                    {lawyers.map(lawyer => (
                      <label key={lawyer.id} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={form.supervisorIds.includes(lawyer.id)}
                          onChange={(e) => {
                            const ids = e.target.checked
                              ? [...form.supervisorIds, lawyer.id]
                              : form.supervisorIds.filter(id => id !== lawyer.id);
                            setForm({ ...form, supervisorIds: ids });
                          }}
                          className="w-4 h-4 rounded border-border text-indigo-500 focus:ring-indigo-500/20"
                        />
                        <div>
                          <span className="text-[13px] text-foreground group-hover:text-indigo-400 transition-colors">{lawyer.name}</span>
                          {lawyer.specialties?.length > 0 && (
                            <span className="ml-1 text-[9px] text-muted-foreground">({lawyer.specialties.join(', ')})</span>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground opacity-70 ml-1">
                    Vincule este usuário como estagiário de um ou mais advogados.
                  </p>
                </div>
              )}

              </div>{/* fim do div scrollável */}
              <div className="flex justify-end space-x-3 px-6 py-4 border-t border-border shrink-0">
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
