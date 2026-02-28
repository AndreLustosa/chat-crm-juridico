'use client';

import { useState } from 'react';
import { Search, User, MessageSquare } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';

const DEMO_CONTACTS = [
  { id: '1', name: 'João Silva', phone: '82999001122', email: 'joao@email.com', conversations: 3, lastMessage: '28/02/2026', createdAt: '29/01/2026' },
  { id: '2', name: 'Maria Santos', phone: '82998776655', email: 'maria@email.com', conversations: 1, lastMessage: '28/02/2026', createdAt: '21/02/2026' },
  { id: '3', name: 'Carlos Oliveira', phone: '82997654321', email: 'carlos@email.com', conversations: 2, lastMessage: '28/02/2026', createdAt: '14/02/2026' },
  { id: '4', name: 'Ana Pereira', phone: '82996543210', email: '-', conversations: 1, lastMessage: '-', createdAt: '27/02/2026' },
  { id: '5', name: 'Roberto Lima', phone: '82995432109', email: 'roberto@email.com', conversations: 5, lastMessage: '27/02/2026', createdAt: '30/12/2025' },
  { id: '6', name: 'Fernanda Alves', phone: '82994321098', email: 'fernanda@email.com', conversations: 2, lastMessage: '26/02/2026', createdAt: '19/01/2026' },
];

export default function ContactsPage() {
  const [search, setSearch] = useState('');

  const filteredContacts = DEMO_CONTACTS.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.phone.includes(search) || 
    c.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col bg-background overflow-hidden">
        {/* Header Section */}
        <header className="px-8 py-6 shrink-0 flex items-center justify-between border-b border-border bg-card/30 backdrop-blur-md">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Contatos</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">{DEMO_CONTACTS.length} contatos cadastrados</p>
          </div>

          <div className="relative w-80 group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <input 
              type="text" 
              placeholder="Buscar por nome, telefone ou email..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-foreground/[0.03] border border-border rounded-xl text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
            />
          </div>
        </header>

        {/* Table Section */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <table className="w-full text-left table-auto">
              <thead>
                <tr className="bg-foreground/[0.02] border-b border-border">
                  <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nome</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Telefone</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Email</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">Conversas</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Última Conversa</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Cadastro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/[0.04]">
                {filteredContacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-foreground/[0.02] transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs shadow-sm">
                          {contact.name.charAt(0)}
                        </div>
                        <span className="text-[14px] font-semibold text-foreground tracking-tight">{contact.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-[13px] text-muted-foreground font-medium">{contact.phone}</td>
                    <td className="px-6 py-5 text-[13px] text-muted-foreground font-medium">{contact.email}</td>
                    <td className="px-6 py-5 text-center">
                      <span className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold border border-primary/20">
                        {contact.conversations}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-[13px] text-muted-foreground opacity-70 font-medium">{contact.lastMessage}</td>
                    <td className="px-6 py-5 text-[13px] text-muted-foreground opacity-70 font-medium">{contact.createdAt}</td>
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
        </div>
      </main>
    </div>
  );
}
