'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, FileText, ListTodo, Clock, MessageSquare, Activity,
  Loader2, AlertTriangle, ClipboardList,
} from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';
import TabResumo from './components/TabResumo';
import TabDocumentos from './components/TabDocumentos';
import TabTarefas from './components/TabTarefas';
import TabPrazos from './components/TabPrazos';
import TabComunicacoes from './components/TabComunicacoes';
import TabTimeline from './components/TabTimeline';

// ─── Types ────────────────────────────────────────────────────

interface WorkspaceData {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  lawyer_id: string;
  case_number: string | null;
  legal_area: string | null;
  stage: string;
  in_tracking: boolean;
  tracking_stage: string | null;
  filed_at: string | null;
  archived: boolean;
  archive_reason: string | null;
  notes: string | null;
  court: string | null;
  action_type: string | null;
  claim_value: number | null;
  opposing_party: string | null;
  judge: string | null;
  created_at: string;
  updated_at: string;
  lead: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    profile_picture_url: string | null;
    memory: { summary: string; facts_json: any } | null;
    ficha_trabalhista: { data: any; completion_pct: number; finalizado: boolean } | null;
  };
  conversation: {
    id: string;
    instance_name: string | null;
    status: string;
    legal_area: string | null;
  } | null;
  lawyer: {
    id: string;
    name: string;
    email: string;
  };
  _count: {
    tasks: number;
    events: number;
    documents: number;
    deadlines: number;
    djen_publications: number;
    calendar_events: number;
  };
}

type TabId = 'resumo' | 'documentos' | 'tarefas' | 'prazos' | 'comunicacoes' | 'timeline';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'resumo', label: 'Resumo', icon: ClipboardList },
  { id: 'documentos', label: 'Documentos', icon: FileText },
  { id: 'tarefas', label: 'Tarefas', icon: ListTodo },
  { id: 'prazos', label: 'Prazos', icon: Clock },
  { id: 'comunicacoes', label: 'Comunicações', icon: MessageSquare },
  { id: 'timeline', label: 'Timeline', icon: Activity },
];

// ─── Workspace Page ───────────────────────────────────────────

export default function WorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.caseId as string;

  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('resumo');

  const fetchWorkspace = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get(`/legal-cases/${caseId}/workspace`);
      setData(res.data);
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Erro ao carregar workspace';
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  // ─── Loading / Error ────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-base-100">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-base-100">
        <AlertTriangle className="h-12 w-12 text-warning" />
        <p className="text-base-content/70">{error || 'Caso não encontrado'}</p>
        <button
          onClick={() => router.back()}
          className="btn btn-outline btn-sm"
        >
          Voltar
        </button>
      </div>
    );
  }

  const clientName = data.lead?.name || 'Cliente sem nome';
  const stageLabel = data.in_tracking ? (data.tracking_stage || data.stage) : data.stage;

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col bg-base-100">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-base-300 bg-base-200/50 px-4 py-3">
        <button
          onClick={() => router.back()}
          className="btn btn-ghost btn-sm btn-circle"
          title="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-base-content truncate">
              {clientName}
            </h1>
            {data.legal_area && (
              <span className="badge badge-outline badge-sm whitespace-nowrap">
                {data.legal_area}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-base-content/60">
            {data.case_number && (
              <span>Processo: {data.case_number}</span>
            )}
            {data.court && (
              <>
                <span className="text-base-content/30">•</span>
                <span>{data.court}</span>
              </>
            )}
            <span className="text-base-content/30">•</span>
            <span className="badge badge-xs badge-primary">{stageLabel}</span>
            <span className="text-base-content/30">•</span>
            <span>Adv: {data.lawyer.name}</span>
          </div>
        </div>

        {data.archived && (
          <span className="badge badge-warning badge-sm gap-1">
            <AlertTriangle className="h-3 w-3" />
            Arquivado
          </span>
        )}
      </header>

      {/* Body: sidebar tabs + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tab sidebar */}
        <nav className="flex w-14 flex-col border-r border-base-300 bg-base-200/30 py-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  group relative flex flex-col items-center justify-center py-3 px-1
                  transition-colors
                  ${isActive
                    ? 'text-primary bg-primary/10 border-r-2 border-primary'
                    : 'text-base-content/50 hover:text-base-content hover:bg-base-300/50'
                  }
                `}
                title={tab.label}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[9px] mt-0.5 leading-tight">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tab content */}
        <main className="flex-1 overflow-y-auto">
          {activeTab === 'resumo' && (
            <TabResumo data={data} onRefresh={fetchWorkspace} />
          )}
          {activeTab === 'documentos' && (
            <TabDocumentos caseId={caseId} />
          )}
          {activeTab === 'tarefas' && (
            <TabTarefas caseId={caseId} lawyerId={data.lawyer_id} />
          )}
          {activeTab === 'prazos' && (
            <TabPrazos caseId={caseId} />
          )}
          {activeTab === 'comunicacoes' && (
            <TabComunicacoes caseId={caseId} />
          )}
          {activeTab === 'timeline' && (
            <TabTimeline caseId={caseId} />
          )}
        </main>
      </div>
    </div>
  );
}
