'use client';

import { useState, useEffect } from 'react';
import { Search, User, RefreshCw, Loader2, Phone, MessageSquare } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import api from '@/lib/api';

interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  conversations: number;
  lastMessage: string;
  createdAt: string;
  origin: 'whatsapp' | 'database' | 'both';
}

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const formatDate = (date: string | null | undefined) => {
    if (!date) return '-';
    try {
      return new Date(date).toLocaleDateString('pt-BR');
    } catch {
      return '-';
    }
  };

  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 13) {
      // 55 82 9 9900-1122
      return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 5)} ${digits.slice(5, 9)}-${digits.slice(9)}`;
    }
    if (digits.length === 12) {
      return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
    }
    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    return phone;
  };

  const fetchContacts = async (showSyncIndicator = false) => {
    try {
      if (showSyncIndicator) setSyncing(true);
      else setLoading(true);

      // Buscar leads do banco de dados
      const leadsRes = await api.get('/leads');
      const leads = leadsRes.data || [];

      // Mapear leads do banco para o formato de contato
      const dbContacts: Contact[] = leads.map((lead: any) => ({
        id: lead.id,
        name: lead.name || lead.phone,
        phone: lead.phone,
        email: lead.email || '',
        conversations: lead._count?.conversations || 0,
        lastMessage: formatDate(lead.conversations?.[0]?.last_message_at),
        createdAt: formatDate(lead.created_at),
        origin: 'database' as const,
      }));

      // Buscar instâncias WhatsApp conectadas
      let whatsappContacts: Contact[] = [];
      try {
        const instancesRes = await api.get('/whatsapp/instances');
        const instances = instancesRes.data || [];

        // Para cada instância conectada, buscar contatos
        const connectedInstances = instances.filter(
          (inst: any) => inst.status === 'open'
        );

        for (const instance of connectedInstances) {
          try {
            const contactsRes = await api.get(
              `/whatsapp/instances/${instance.instanceName}/contacts`
            );
            const waContacts = contactsRes.data || [];

            for (const wc of waContacts) {
              whatsappContacts.push({
                id: `wa_${wc.id}`,
                name: wc.name || wc.phone,
                phone: wc.phone,
                email: '',
                conversations: 0,
                lastMessage: '-',
                createdAt: '-',
                origin: 'whatsapp',
              });
            }
          } catch (err) {
            console.warn(`Erro ao buscar contatos da instância ${instance.instanceName}:`, err);
          }
        }
      } catch (err) {
        console.warn('Erro ao buscar instâncias WhatsApp:', err);
      }

      // Merge: contatos do DB têm prioridade, WhatsApp complementa
      const phoneMap = new Map<string, Contact>();

      // Primeiro: adiciona contatos do DB
      for (const c of dbContacts) {
        const normalizedPhone = c.phone.replace(/\D/g, '');
        phoneMap.set(normalizedPhone, c);
      }

      // Depois: adiciona contatos do WhatsApp que não existem no DB
      for (const c of whatsappContacts) {
        const normalizedPhone = c.phone.replace(/\D/g, '');
        if (phoneMap.has(normalizedPhone)) {
          // Atualiza nome se o do DB estiver vazio
          const existing = phoneMap.get(normalizedPhone)!;
          if ((!existing.name || existing.name === existing.phone) && c.name && c.name !== c.phone) {
            existing.name = c.name;
          }
          existing.origin = 'both';
        } else {
          phoneMap.set(normalizedPhone, c);
        }
      }

      const merged = Array.from(phoneMap.values()).sort((a, b) => {
        // Contatos com conversas primeiro
        if (a.conversations !== b.conversations) return b.conversations - a.conversations;
        return a.name.localeCompare(b.name);
      });

      setContacts(merged);
    } catch (err) {
      console.error('Erro ao carregar contatos:', err);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col bg-background overflow-hidden">
        {/* Header Section */}
        <header className="px-8 py-6 shrink-0 flex items-center justify-between border-b border-border bg-card/30 backdrop-blur-md">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Contatos</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {loading ? 'Carregando...' : `${contacts.length} contatos encontrados`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchContacts(true)}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-background hover:bg-foreground/[0.03] text-[13px] font-medium text-muted-foreground transition-all disabled:opacity-50"
              title="Sincronizar contatos do WhatsApp"
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Sincronizar
            </button>

            <div className="relative w-80 group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <input
                type="text"
                placeholder="Buscar por nome, telefone ou email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-xl text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
              />
            </div>
          </div>
        </header>

        {/* Table Section */}
        <div className="flex-1 overflow-y-auto p-8">
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
                    <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Última Conversa</th>
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
                        {contact.conversations > 0 ? (
                          <span className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold border border-primary/20">
                            {contact.conversations}
                          </span>
                        ) : (
                          <span className="text-[13px] text-muted-foreground/40">-</span>
                        )}
                      </td>
                      <td className="px-6 py-5 text-[13px] text-muted-foreground opacity-70 font-medium">{contact.lastMessage}</td>
                      <td className="px-6 py-5">
                        {contact.origin === 'whatsapp' || contact.origin === 'both' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 text-[11px] font-semibold border border-green-500/20">
                            <Phone className="w-3 h-3" />
                            WhatsApp
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 text-[11px] font-semibold border border-blue-500/20">
                            <MessageSquare className="w-3 h-3" />
                            CRM
                          </span>
                        )}
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
