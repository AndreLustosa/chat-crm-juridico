'use client';

import { useState, useEffect } from 'react';
import {
  Briefcase,
  Plus,
  Trash2,
  UserPlus,
  Users,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import api from '@/lib/api';

interface Sector {
  id: string;
  name: string;
  auto_route: boolean;
  users: Array<{ id: string; name: string; email: string }>;
}

interface User {
  id: string;
  name: string;
  email: string;
}

export default function SectorsSettingsPage() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddSector, setShowAddSector] = useState(false);
  const [newSectorName, setNewSectorName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sectorsRes, usersRes] = await Promise.all([
        api.get('/sectors'),
        api.get('/users'),
      ]);
      setSectors(sectorsRes.data);
      setAllUsers(usersRes.data);
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateSector = async () => {
    if (!newSectorName.trim()) return;
    setIsCreating(true);
    try {
      await api.post('/sectors', { name: newSectorName });
      setNewSectorName('');
      setShowAddSector(false);
      fetchData();
    } catch (error) {
      alert('Erro ao criar departamento');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSector = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este departamento?')) return;
    try {
      await api.delete(`/sectors/${id}`);
      fetchData();
    } catch (error) {
      alert('Erro ao excluir departamento');
    }
  };

  const handleAddUser = async (sectorId: string, userId: string) => {
    try {
      await api.post(`/sectors/${sectorId}/users`, { userId });
      fetchData();
    } catch (error) {
      alert('Erro ao adicionar usuário ao departamento');
    }
  };

  const handleRemoveUser = async (sectorId: string, userId: string) => {
    try {
      await api.delete(`/sectors/${sectorId}/users/${userId}`);
      fetchData();
    } catch (error) {
      alert('Erro ao remover usuário do departamento');
    }
  };

  const handleToggleAutoRoute = async (id: string, value: boolean) => {
    const sector = sectors.find(s => s.id === id);
    if (!sector) return;
    try {
      await api.patch(`/sectors/${id}`, { name: sector.name, autoRoute: value });
      fetchData();
    } catch (error) {
      alert('Erro ao atualizar roteamento automático');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <header className="p-8 border-b border-border bg-card/30 backdrop-blur-md">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Briefcase size={24} />
            </div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Departamentos Internos</h1>
          </div>
          <p className="text-muted-foreground">
            Grupos de colaboradores para transferência interna de conversas. Não recebem mensagens iniciais do WhatsApp.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto space-y-8">

          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="text-primary" size={20} />
              Departamentos Cadastrados
            </h2>
            <button
              onClick={() => setShowAddSector(true)}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
            >
              <Plus size={18} />
              Novo Departamento
            </button>
          </div>

          {showAddSector && (
            <div className="bg-card border-2 border-primary/20 rounded-2xl p-6 animate-in slide-in-from-top-4 duration-300">
              <h3 className="font-bold mb-4">Criar Novo Departamento</h3>
              <div className="flex gap-4">
                <input
                  type="text"
                  value={newSectorName}
                  onChange={(e) => setNewSectorName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateSector()}
                  placeholder="Ex: Advogados, Financeiro, Estagiários..."
                  className="flex-1 bg-muted border border-border rounded-xl px-4 py-2 outline-none focus:border-primary/50"
                  autoFocus
                />
                <button
                  onClick={() => setShowAddSector(false)}
                  className="px-6 py-2 text-sm font-bold text-muted-foreground hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  disabled={isCreating}
                  onClick={handleCreateSector}
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
              <p>Carregando departamentos...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {sectors.map((sector) => (
                <div
                  key={sector.id}
                  className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden group hover:border-primary/20 transition-all"
                >
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-primary/5 text-primary flex items-center justify-center">
                          <Briefcase size={24} />
                        </div>
                        <div>
                          <h3 className="text-2xl font-black text-foreground">{sector.name}</h3>
                          <div className="flex items-center gap-4 text-xs font-bold text-muted-foreground uppercase tracking-wider mt-1">
                            <span className="flex items-center gap-1">
                              <Users size={12} /> {sector.users?.length || 0} Membros
                            </span>
                            <span className="text-amber-500 text-[10px] font-bold uppercase">
                              🏢 Apenas transferências
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteSector(sector.id)}
                        className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>

                    {/* Equipe do Departamento */}
                    <div className="space-y-4">
                      <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                        <UserPlus size={10} className="text-primary" /> Membros do Departamento
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {sector.users?.map((user) => (
                          <div
                            key={user.id}
                            className="bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2"
                          >
                            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px]">
                              {user.name[0]}
                            </div>
                            {user.name}
                            <button
                              onClick={() => handleRemoveUser(sector.id, user.id)}
                              className="ml-1 hover:text-red-500"
                            >
                              ×
                            </button>
                          </div>
                        ))}

                        <select
                          onChange={(e) => {
                            if (e.target.value) handleAddUser(sector.id, e.target.value);
                            e.target.value = '';
                          }}
                          className="bg-muted border border-border hover:border-primary/30 rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer outline-none"
                        >
                          <option value="">+ Adicionar Membro</option>
                          {allUsers
                            .filter((au) => !sector.users?.some((u) => u.id === au.id))
                            .map((au) => (
                              <option key={au.id} value={au.id}>
                                {au.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

                    {/* Toggle Roteamento Automático */}
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <label
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => handleToggleAutoRoute(sector.id, !sector.auto_route)}
                      >
                        <div className={`relative w-10 h-5 rounded-full transition-colors ${sector.auto_route ? 'bg-violet-500' : 'bg-muted'}`}>
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sector.auto_route ? 'translate-x-5' : 'translate-x-0'}`} />
                        </div>
                        <div>
                          <span className="text-sm font-bold">🤖 Roteamento automático por IA</span>
                          <p className="text-[11px] text-muted-foreground">
                            {sector.auto_route
                              ? 'A IA vincula automaticamente um especialista deste departamento ao lead'
                              : 'Transferências manuais — atendente escolhe o destinatário'}
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              ))}

              {sectors.length === 0 && (
                <div className="py-20 border-2 border-dashed border-border rounded-3xl flex flex-col items-center justify-center text-center px-6">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                    <Briefcase size={32} className="text-muted-foreground opacity-30" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">Nenhum departamento cadastrado</h3>
                  <p className="text-muted-foreground max-w-sm mb-6">
                    Crie departamentos como "Advogados", "Financeiro" ou "Estagiários" para transferências internas sem vínculo com WhatsApp.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
