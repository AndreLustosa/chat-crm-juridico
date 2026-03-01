'use client';

import { useState, useEffect } from 'react';
import { 
  Building2, 
  Plus, 
  Trash2, 
  UserPlus, 
  Users, 
  Settings2,
  CheckCircle2,
  RefreshCw,
  MessageSquare,
  Link,
  ChevronRight,
  ShieldCheck,
  Zap,
  Layout
} from 'lucide-react';
import api from '@/lib/api';

interface Inbox {
  id: string;
  name: string;
  users: Array<{ id: string; name: string; email: string }>;
  instances: Array<{ id: string; name: string; type: string }>;
  _count: {
    users: number;
    conversations: number;
  };
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface EvolutionInstance {
  instanceName: string;
  status: string;
}

export default function InboxesSettingsPage() {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [whatsappInstances, setWhatsappInstances] = useState<EvolutionInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddInbox, setShowAddInbox] = useState(false);
  const [newInboxName, setNewInboxName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [inboxesRes, usersRes, waRes] = await Promise.all([
        api.get('/inboxes'),
        api.get('/users'),
        api.get('/whatsapp/instances')
      ]);
      setInboxes(inboxesRes.data);
      setAllUsers(usersRes.data);
      setWhatsappInstances(waRes.data);
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateInbox = async () => {
    if (!newInboxName.trim()) return;
    setIsCreating(true);
    try {
      await api.post('/inboxes', { name: newInboxName });
      setNewInboxName('');
      setShowAddInbox(false);
      fetchData();
    } catch (error) {
      alert('Erro ao criar setor');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteInbox = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este setor?')) return;
    try {
      await api.delete(`/inboxes/${id}`);
      fetchData();
    } catch (error) {
      alert('Erro ao excluir setor');
    }
  };

  const handleAddUserToInbox = async (inboxId: string, userId: string) => {
    try {
      await api.post(`/inboxes/${inboxId}/users`, { userId });
      fetchData();
    } catch (error) {
      alert('Erro ao adicionar usuário ao setor');
    }
  };

  const handleAddInstanceToInbox = async (inboxId: string, name: string) => {
    try {
      await api.post(`/inboxes/${inboxId}/instances`, { name, type: 'whatsapp' });
      fetchData();
    } catch (error) {
      alert('Erro ao vincular instância ao setor');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <header className="p-8 border-b border-border bg-card/30 backdrop-blur-md">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Layout size={24} />
            </div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Setores e Caixas de Entrada</h1>
          </div>
          <p className="text-muted-foreground">Organize seu atendimento por departamentos e vincule múltiplos canais (WhatsApp/Instagram) a cada setor.</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto space-y-8">
          
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="text-primary" size={20} />
              Departamentos Ativos
            </h2>
            <button 
              onClick={() => setShowAddInbox(true)}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
            >
              <Plus size={18} />
              Novo Setor
            </button>
          </div>

          {showAddInbox && (
            <div className="bg-card border-2 border-primary/20 rounded-2xl p-6 animate-in slide-in-from-top-4 duration-300">
              <h3 className="font-bold mb-4">Criar Novo Departamento</h3>
              <div className="flex gap-4">
                <input 
                  type="text" 
                  value={newInboxName}
                  onChange={(e) => setNewInboxName(e.target.value)}
                  placeholder="Ex: Comercial, Financeiro, Suporte..."
                  className="flex-1 bg-muted border border-border rounded-xl px-4 py-2 outline-none focus:border-primary/50"
                  autoFocus
                />
                <button 
                  onClick={() => setShowAddInbox(false)}
                  className="px-6 py-2 text-sm font-bold text-muted-foreground hover:text-foreground"
                >
                  Cancelar
                </button>
                <button 
                  disabled={isCreating}
                  onClick={handleCreateInbox}
                  className="bg-primary text-primary-foreground px-6 py-2 rounded-xl font-bold text-sm"
                >
                  {isCreating ? <RefreshCw className="animate-spin" size={18} /> : 'Criar Agora'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-20 flex flex-col items-center gap-4 text-muted-foreground">
              <RefreshCw className="animate-spin" size={40} />
              <p>Carregando setores...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {inboxes.map((inbox) => (
                <div key={inbox.id} className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden group hover:border-primary/20 transition-all">
                  <div className="p-6 flex flex-col md:flex-row gap-8">
                    
                    {/* Infos Básicas */}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-2xl bg-primary/5 text-primary flex items-center justify-center">
                            <Building2 size={24} />
                          </div>
                          <div>
                            <h3 className="text-2xl font-black text-foreground">{inbox.name}</h3>
                            <div className="flex items-center gap-4 text-xs font-bold text-muted-foreground uppercase tracking-wider mt-1">
                              <span className="flex items-center gap-1"><Users size={12} /> {inbox._count.users} Operadores</span>
                              <span className="flex items-center gap-1"><MessageSquare size={12} /> {inbox._count.conversations} Chats</span>
                            </div>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleDeleteInbox(inbox.id)}
                          className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                        {/* Canais Vinculados */}
                        <div className="space-y-4">
                          <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                             <Zap size={10} className="text-amber-500" /> Canais de Entrada
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {inbox.instances?.map((inst) => (
                              <div key={inst.id} className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2">
                                <Link size={14} />
                                {inst.name}
                                <span className="opacity-50 font-normal">({inst.type})</span>
                              </div>
                            ))}
                            
                            <select 
                              onChange={(e) => {
                                if(e.target.value) handleAddInstanceToInbox(inbox.id, e.target.value);
                                e.target.value = "";
                              }}
                              className="bg-muted border border-border hover:border-primary/30 rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer outline-none"
                            >
                              <option value="">+ Vincular WhatsApp</option>
                              {whatsappInstances
                                .filter(wi => !inboxes.some(i => i.instances?.some(inst => inst.name === wi.instanceName)))
                                .map(wi => (
                                  <option key={wi.instanceName} value={wi.instanceName}>{wi.instanceName}</option>
                                ))
                              }
                            </select>
                          </div>
                        </div>

                        {/* Equipe do Setor */}
                        <div className="space-y-4">
                          <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                             <UserPlus size={10} className="text-primary" /> Equipe do Departamento
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {inbox.users?.map((user) => (
                              <div key={user.id} className="bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2">
                                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px]">
                                  {user.name[0]}
                                </div>
                                {user.name}
                                <button 
                                  onClick={async () => {
                                    await api.delete(`/inboxes/${inbox.id}/users/${user.id}`);
                                    fetchData();
                                  }}
                                  className="ml-1 hover:text-red-500"
                                >
                                  ×
                                </button>
                              </div>
                            ))}

                            <select 
                              onChange={(e) => {
                                if(e.target.value) handleAddUserToInbox(inbox.id, e.target.value);
                                e.target.value = "";
                              }}
                              className="bg-muted border border-border hover:border-primary/30 rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer outline-none"
                            >
                              <option value="">+ Adicionar Operador</option>
                              {allUsers
                                .filter(au => !inbox.users?.some(u => u.id === au.id))
                                .map(au => (
                                  <option key={au.id} value={au.id}>{au.name}</option>
                                ))
                              }
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {inboxes.length === 0 && (
                <div className="py-20 border-2 border-dashed border-border rounded-3xl flex flex-col items-center justify-center text-center px-6">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                    <Building2 size={32} className="text-muted-foreground opacity-30" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">Nenhum setor configurado</h3>
                  <p className="text-muted-foreground max-w-sm mb-6">Crie seu primeiro departamento (ex: Atendimento) para organizar suas conversas.</p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
