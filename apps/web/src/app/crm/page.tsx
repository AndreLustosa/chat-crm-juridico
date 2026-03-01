'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { User } from 'lucide-react';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';

const STAGES = [
  { id: 'NEW', label: 'NOVO', color: '#5b8def' },
  { id: 'CONTACTED', label: 'CONTATADO', color: '#fbbf24' },
  { id: 'QUALIFIED', label: 'QUALIFICADO', color: '#a78bfa' },
  { id: 'PROPOSAL', label: 'PROPOSTA', color: '#f97316' },
  { id: 'WON', label: 'GANHO', color: '#34d399' }
];

const DEMO_LEADS = [
  { id: 'l1', title: 'Trabalhista - Ana Pereira', contactName: 'Ana Pereira', value: 5000, stage: 'NEW', updatedAt: new Date().toISOString() },
  { id: 'l2', title: 'Previdenciário - Pedro Costa', contactName: 'Pedro Costa', stage: 'NEW', updatedAt: new Date().toISOString() },
  { id: 'l3', title: 'Trabalhista - João Silva', contactName: 'João Silva', value: 12000, stage: 'CONTACTED', updatedAt: new Date().toISOString() },
  { id: 'l4', title: 'Família - Maria Santos', contactName: 'Maria Santos', value: 8000, stage: 'CONTACTED', updatedAt: new Date().toISOString() },
  { id: 'l5', title: 'Cível - Lucas Mendes', contactName: 'Lucas Mendes', value: 3500, stage: 'CONTACTED', updatedAt: new Date().toISOString() },
  { id: 'l6', title: 'Trabalhista - Carlos Oliveira', contactName: 'Carlos Oliveira', value: 15000, stage: 'QUALIFIED', updatedAt: new Date().toISOString() },
  { id: 'l7', title: 'Previdenciário - Roberto Lima', contactName: 'Roberto Lima', value: 20000, stage: 'PROPOSAL', updatedAt: new Date().toISOString() },
  { id: 'l8', title: 'Família - Fernanda Alves', contactName: 'Fernanda Alves', value: 10000, stage: 'PROPOSAL', updatedAt: new Date().toISOString() },
  { id: 'l9', title: 'Trabalhista - Marcos Souza', contactName: 'Marcos Souza', value: 25000, stage: 'WON', updatedAt: new Date().toISOString() }
];

export default function CrmPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<any[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token && process.env.NODE_ENV !== 'development') {
      router.push('/login');
      return;
    }

    const fetchLeads = async () => {
      try {
        const res = await api.get('/leads');
        // Map actual leads if they come from the API, else use DEMO
        setLeads(res.data.length > 0 ? res.data : DEMO_LEADS);
      } catch (e: any) {
        console.warn('Backend offline - Mock Mode ativado (sem leads reais)');
        setLeads(DEMO_LEADS);
        if (e.response?.status === 401 && process.env.NODE_ENV !== 'development') {
           localStorage.removeItem('token');
           router.push('/login');
        }
      }
    };
    fetchLeads();
  }, [router]);

  const formatCurrency = (value?: number) => {
    if (!value) return '';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  return (
    <div className="flex h-screen bg-background font-sans antialiased text-foreground overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
        <header className="px-8 mb-6 shrink-0">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">CRM Pipeline</h1>
          <p className="text-[13px] text-muted-foreground mt-1">Gerencie seus leads e oportunidades</p>
        </header>

        <div className="flex-1 overflow-x-auto overflow-y-hidden px-8 pb-8">
          <div className="flex h-full gap-5">
            {STAGES.map(stage => {
              // Map real leads to stages, or map by ID
              const stageLeads = leads
                .filter(l => {
                  const leadStage = (l.stage || 'NEW').toUpperCase();
                  return leadStage === stage.id || leadStage === stage.label; 
                })
                .sort((a, b) => {
                  const nameA = a.contactName || a.title || a.name || '';
                  const nameB = b.contactName || b.title || b.name || '';
                  return nameA.localeCompare(nameB);
                });
              
              return (
                <div key={stage.id} className="flex flex-col min-w-[280px] w-[280px] bg-card border border-border rounded-xl max-h-full shadow-sm">
                  <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
                    <div className="flex items-center gap-2.5">
                       <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: stage.color }} />
                       <h3 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: stage.color }}>
                         {stage.label}
                       </h3>
                    </div>
                    <span className="w-[22px] h-[22px] rounded-full bg-foreground/[0.05] text-muted-foreground text-[10px] font-bold flex items-center justify-center">
                      {stageLeads.length}
                    </span>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                    {stageLeads.map(lead => (
                      <div 
                        key={lead.id} 
                        onClick={() => router.push(`/chat/${lead.id}`)} 
                        className="p-3.5 bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl cursor-pointer hover:bg-foreground/[0.08] hover:border-foreground/10 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 transition-all backdrop-blur-md"
                      >
                        <div className="flex items-center gap-3 mb-2.5">
                          <div className="w-8 h-8 rounded-full bg-foreground/[0.05] border border-foreground/[0.1] flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                            {lead.profile_picture_url ? (
                              <img src={lead.profile_picture_url} alt={lead.name} className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <User size={14} className="text-muted-foreground opacity-50" />
                            )}
                          </div>
                          <div>
                            <h4 className="text-[13px] font-semibold text-foreground leading-tight">
                              {lead.title || lead.name || 'Negócio sem título'}
                            </h4>
                            <span className="text-[11px] text-muted-foreground opacity-70">
                              {lead.contactName || formatPhone(lead.phone) || 'Sem contato'}
                            </span>
                          </div>
                        </div>

                        {lead.value && (
                           <div className="text-[13px] font-bold text-[#34d399] mt-2.5 tracking-tight">
                             {formatCurrency(lead.value)}
                           </div>
                        )}
                      </div>
                    ))}
                    
                    {stageLeads.length === 0 && (
                      <div className="text-center p-4 border-2 border-dashed border-border/50 rounded-xl text-xs text-muted-foreground mt-2 opacity-50">
                        Arraste leads aqui
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
