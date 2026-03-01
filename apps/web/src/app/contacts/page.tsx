'use client';

import { useState, useEffect } from 'react';
import { Search, User, MessageSquare, Phone, Loader2 } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import api from '@/lib/api';

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  conversations: number;
  lastMessage: string;
  origin: string; // 'whatsapp' | 'crm'
  instanceName?: string;
}

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAllContacts = async () => {
      try {
        setLoading(true);
        // 1. Busca instâncias ativas
        const instancesResponse = await api.get('/whatsapp/instances');
        const activeInstances = instancesResponse.data.filter((inst: any) => inst.status === 'open');

        // 2. Busca contatos de cada instância ativa
        const allContacts: Contact[] = [];
        
        await Promise.all(activeInstances.map(async (inst: any) => {
          try {
            const contactsResponse = await api.get(`/whatsapp/instances/${inst.instanceName}/contacts`);
            
            // Extração extra-robusta para Evolution v2
            // Pode vir como: { data: [...] }, { instances: [...] }, ou o próprio array
            const responseData = contactsResponse.data;
            const rawContacts = responseData?.data || responseData?.instances || (Array.isArray(responseData) ? responseData : []);
            
            if (Array.isArray(rawContacts)) {
              rawContacts.forEach((rc: any) => {
                // Tenta extrair o telefone de várias formas (v1 vs v2)
                const fullId = rc.id || rc.jid || '';
                const phone = fullId.split('@')[0] || rc.number || rc.phone || '';
                
                if (!phone) return;

                // Evita duplicatas baseadas no telefone se vierem da mesma instância
                allContacts.push({
                  id: fullId || `${inst.instanceName}-${phone}`,
                  name: rc.name || rc.pushName || rc.verifiedName || 'Sem Nome',
                  phone: phone,
                  email: rc.email || '-',
                  conversations: 0,
                  lastMessage: '-',
                  origin: 'whatsapp',
                  instanceName: inst.instanceName
                });
              });
            } else {
              console.warn(`Resposta de contatos da instância ${inst.instanceName} não é um array:`, responseData);
            }
          } catch (e) {
            console.error(`Erro ao buscar contatos da instância ${inst.instanceName}:`, e);
          }
        }));

        setContacts(allContacts);
      } catch (error) {
        console.error('Erro ao carregar contatos:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAllContacts();
  }, []);

  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.phone.includes(search)
  );

  const formatPhone = (phone: string) => {
    if (phone.length === 13) {
      return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 5)} ${phone.slice(5, 9)}-${phone.slice(9)}`;
    }
    return phone;
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden text-foreground">
      <Sidebar />

      <main className="flex-1 flex flex-col bg-background overflow-hidden relative">
        {/* Header Section */}
        <header className="px-8 py-6 shrink-0 flex items-center justify-between border-b border-border bg-card/30 backdrop-blur-md z-10">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Contatos</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {loading ? 'Carregando...' : `${contacts.length} contatos sincronizados`}
            </p>
          </div>

          <div className="relative w-80 group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou telefone..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-xl text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
            />
          </div>
        </header>

        {/* Table Section */}
        <div className="flex-1 overflow-y-auto p-8 bg-foreground/[0.01]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <Loader2 className="w-10 h-10 animate-spin mb-4" />
              <p className="text-sm font-medium">Carregando contatos...</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <table className="w-full text-left table-auto">
                <thead>
                  <tr className="bg-foreground/[0.02] border-b border-border">
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nome</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Telefone</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Email</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">Conversas</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Última Mensagem</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/[0.04]">
                  {filteredContacts.map((contact) => (
                    <tr key={contact.id} className="hover:bg-foreground/[0.02] transition-colors group">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-4">
                          <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs shadow-sm">
                            {contact.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-[14px] font-semibold text-foreground tracking-tight">{contact.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-[13px] text-muted-foreground font-medium">
                        {formatPhone(contact.phone)}
                      </td>
                      <td className="px-6 py-5 text-[13px] text-muted-foreground font-medium">{contact.email || '-'}</td>
                      <td className="px-6 py-5 text-center">
                        <span className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold border border-primary/20">
                          {contact.conversations}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-[13px] text-muted-foreground opacity-70 font-medium">{contact.lastMessage}</td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 text-[10px] font-bold uppercase tracking-wider border border-green-500/20">
                            <Phone className="w-3 h-3" />
                            WhatsApp
                          </span>
                          {contact.instanceName && (
                            <span className="text-[10px] text-muted-foreground font-mono ml-2">
                              via {contact.instanceName}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredContacts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-20 text-center">
                        <div className="flex flex-col items-center opacity-30">
                          <User className="w-12 h-12 mb-3 stroke-[1.2]" />
                          <p className="text-sm font-medium">Nenhum contato encontrado</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
