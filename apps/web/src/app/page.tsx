'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import api from '@/lib/api';

const DEMO_CONVERSATIONS = [
  { id: '1', contactName: 'João Silva', contactPhone: '82999001122', channel: 'WEB', status: 'ACTIVE', lastMessage: 'Preciso de orientação sobre meu caso trabalhista', lastMessageAt: new Date().toISOString(), assignedAgentName: 'André Lustosa' },
  { id: '2', contactName: 'Maria Santos', contactPhone: '82998776655', channel: 'WHATSAPP', status: 'WAITING', lastMessage: 'Boa tarde, vocês atendem direito de família?', lastMessageAt: new Date(Date.now() - 300000).toISOString() },
  { id: '3', contactName: 'Carlos Oliveira', contactPhone: '82997654321', channel: 'WEB', status: 'BOT', lastMessage: 'Quero saber sobre consulta previdenciária', lastMessageAt: new Date(Date.now() - 600000).toISOString() },
  { id: '4', contactName: 'Ana Pereira', contactPhone: '82996543210', channel: 'INSTAGRAM', status: 'BOT', lastMessage: 'Olá, preciso de um advogado', lastMessageAt: new Date(Date.now() - 1200000).toISOString() },
  { id: '5', contactName: 'Roberto Lima', contactPhone: '82995432109', channel: 'WEB', status: 'CLOSED', lastMessage: 'Muito obrigado pelo atendimento!', lastMessageAt: new Date(Date.now() - 86400000).toISOString() },
];

export default function Dashboard() {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [conversations, setConversations] = useState(DEMO_CONVERSATIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setConversations(filter ? DEMO_CONVERSATIONS.filter(c => c.status === filter) : DEMO_CONVERSATIONS);
  }, [filter]);

  const selected = conversations.find((c) => c.id === selectedId);

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const getInitial = (name?: string) => (name || 'V')[0].toUpperCase();

  const statusBadge = (status: string) => {
    const map: Record<string, { class: string; label: string }> = {
      BOT: { class: 'bg-purple-500/15 text-purple-400 dark:text-purple-300 border border-purple-500/20', label: '🤖 Bot' },
      WAITING: { class: 'bg-amber-500/15 text-amber-500 border border-amber-500/20 shadow-[0_0_10px_rgba(251,191,36,0.15)]', label: '⏳ Aguardando' },
      ACTIVE: { class: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20', label: '🟢 Ativo' },
      CLOSED: { class: 'bg-gray-500/15 text-gray-400 border border-gray-500/20', label: '⬛ Fechado' },
    };
    const badge = map[status] || map.CLOSED;
    return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.class}`}>{badge.label}</span>;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans antialiased text-foreground">
      
      <Sidebar />

      {/* 2) CAIXA DE ENTRADA (COLUNA 360px) */}
      <section className="w-[380px] flex flex-col bg-card border-r border-border shrink-0 z-40">
        <div className="p-5 border-b border-border">
          <h2 className="text-xl font-bold mb-4">Inbox</h2>
          <div className="flex bg-muted rounded-xl p-1 w-full relative">
            {[
              { value: '', label: 'Todas' },
              { value: 'BOT', label: 'Bot' },
              { value: 'WAITING', label: 'Aguardando' },
              { value: 'ACTIVE', label: 'Ativas' },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`flex-1 py-1.5 text-[12px] font-semibold rounded-lg transition-all ${filter === tab.value ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-background/50'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto w-full custom-scrollbar">
          {conversations.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">Nenhuma conversa encontrada.</div>
          ) : (
            conversations.map((conv) => (
              <div 
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={`flex gap-4 p-4 border-b border-border/50 cursor-pointer transition-colors relative
                  ${selectedId === conv.id ? 'bg-accent/50' : 'hover:bg-accent/30'}
                `}
              >
                {selectedId === conv.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                <div className="w-11 h-11 rounded-full bg-[#2a2a2a] border border-[#3a3a3a] text-white flex items-center justify-center font-bold text-lg shrink-0">
                  {getInitial(conv.contactName)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-foreground truncate pl-0.5">{conv.contactName || 'Visitante'}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{formatTime(conv.lastMessageAt)}</span>
                  </div>
                  <div className="mb-2">
                    {statusBadge(conv.status)}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{conv.lastMessage}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* 3) PAINEL PRINCIPAL DE CONVERSA */}
      <main className="flex-1 flex flex-col bg-background relative">
        {selected ? (
          <>
            <header className="h-[80px] px-8 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
               <div className="flex items-center gap-4">
                 <div className="w-12 h-12 rounded-full bg-[#2a2a2a] border border-[#3a3a3a] text-white flex items-center justify-center font-bold text-xl shadow-sm">
                   {getInitial(selected.contactName)}
                 </div>
                 <div>
                   <h3 className="font-bold text-lg leading-tight">{selected.contactName}</h3>
                   <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">
                     {selected.channel} <span className="mx-1">•</span> {selected.contactPhone}
                   </div>
                 </div>
               </div>
               <div className="flex gap-3">
                 {selected.status === 'WAITING' && (
                   <button className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-ring text-primary-foreground font-bold text-sm shadow-[0_0_15px_rgba(var(--primary),0.3)] hover:shadow-[0_0_20px_rgba(var(--primary),0.4)] hover:-translate-y-0.5 transition-all">
                     Aceitar Atendimento
                   </button>
                 )}
                 {selected.status !== 'CLOSED' && (
                   <button className="px-5 py-2.5 rounded-xl bg-transparent border border-border text-foreground font-semibold text-sm hover:bg-accent transition-colors">
                     Encerrar
                   </button>
                 )}
               </div>
            </header>

            <div className="flex-1 p-8 overflow-y-auto">
              <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-4">
                 {/* Exemplo de fluxo FAKE da conversa */}
                 <div className="w-full flex justify-end">
                    <div className="max-w-[80%] bg-gradient-to-tr from-primary/90 to-ring/90 text-primary-foreground p-4 rounded-2xl rounded-tr-sm shadow-sm relative">
                       <p className="text-[15px] leading-relaxed">Trabalhei 3 anos e 4 meses. Não recebi nada ainda.</p>
                       <span className="text-[10px] text-primary-foreground/70 absolute bottom-1.5 right-3">14:00</span>
                    </div>
                 </div>
                 
                 <div className="w-full flex justify-start">
                    <div className="max-w-[80%] bg-[#122315] border border-[#1b3b22] p-4 rounded-2xl rounded-tl-sm shadow-sm mt-4 text-[#e0f5e5]">
                       <div className="flex items-center gap-2 mb-2 opacity-80">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">👤 André Lustosa</span>
                       </div>
                       <p className="text-[15px] leading-relaxed font-normal">Certo. Com esse tempo você tem direitos significativos. Vamos agendar uma consulta para analisar toda a documentação? Posso atender amanhã às 14h.</p>
                       <span className="text-[10px] opacity-60 mt-1 block">14:01</span>
                    </div>
                 </div>

                 <div className="w-full flex justify-end">
                    <div className="max-w-[80%] bg-gradient-to-tr from-[#a1773d]/90 to-[#eae2a1]/90 text-black p-4 rounded-2xl rounded-tr-sm shadow-sm mt-4">
                       <p className="text-[15px] leading-relaxed font-medium">{selected.lastMessage}</p>
                       <span className="text-[10px] opacity-60 mt-1 flex justify-end">14:02</span>
                    </div>
                 </div>
              </div>
            </div>

            <footer className="p-6 bg-background shrink-0">
               <div className="max-w-4xl mx-auto flex gap-3">
                  <input type="text" placeholder="Digite sua mensagem..." disabled className="flex-1 bg-card border border-border rounded-xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-primary shadow-sm text-foreground disabled:opacity-50" />
                  <button disabled className="bg-gradient-to-r from-primary to-ring p-4 rounded-xl shadow-lg disabled:opacity-50 hover:-translate-y-1 transition-transform">
                     <MessageSquare size={20} className="text-primary-foreground fill-current" />
                  </button>
               </div>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-20 h-20 bg-accent rounded-full flex items-center justify-center mb-6 border border-border">
              <MessageSquare size={32} className="text-muted-foreground opacity-50" />
            </div>
            <h3 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-ring mb-2">LexCRM Inbox</h3>
            <p className="text-muted-foreground font-medium">Selecione uma conversa na lista lateral para iniciar.</p>
          </div>
        )}
      </main>

    </div>
  );
}
