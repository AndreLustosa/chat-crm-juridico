'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, FileText, CalendarDays, Clock, MessageSquare, Activity,
  Loader2, AlertTriangle, ClipboardList, FileSignature, BookOpen,
  DollarSign, Archive, ArchiveRestore, Send, Ban, Undo2,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import TabResumo from './components/TabResumo';
import TabDocumentos from './components/TabDocumentos';
import TabTarefas from './components/TabTarefas';
import TabPrazos from './components/TabPrazos';
import TabComunicacoes from './components/TabComunicacoes';
import TabTimeline from './components/TabTimeline';
import TabPeticoes from './components/TabPeticoes';
import TabBancoPecas from './components/TabBancoPecas';
import TabHonorarios from './components/TabHonorarios';

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
  renounced: boolean;
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

type TabId = 'resumo' | 'documentos' | 'peticoes' | 'banco' | 'tarefas' | 'prazos' | 'honorarios' | 'comunicacoes' | 'timeline';

const LEGAL_STAGES = [
  { id: 'VIABILIDADE', label: 'Viabilidade' },
  { id: 'DOCUMENTACAO', label: 'Documentação' },
  { id: 'PETICAO', label: 'Petição Inicial' },
  { id: 'REVISAO', label: 'Revisão' },
  { id: 'PROTOCOLO', label: 'Protocolo' },
];

const TRACKING_STAGES = [
  { id: 'DISTRIBUIDO', label: 'Distribuído' },
  { id: 'CITACAO', label: 'Citação/Intimação' },
  { id: 'CONTESTACAO', label: 'Contestação' },
  { id: 'REPLICA', label: 'Réplica' },
  { id: 'INSTRUCAO', label: 'Audiência/Instrução' },
  { id: 'JULGAMENTO', label: 'Julgamento/Sentença' },
  { id: 'RECURSO', label: 'Recurso' },
  { id: 'TRANSITADO', label: 'Trânsito em Julgado' },
  { id: 'EXECUCAO', label: 'Execução' },
  { id: 'ENCERRADO', label: 'Encerrado' },
];

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'resumo', label: 'Resumo', icon: ClipboardList },
  { id: 'documentos', label: 'Documentos', icon: FileText },
  { id: 'peticoes', label: 'Petições', icon: FileSignature },
  { id: 'banco', label: 'Peças', icon: BookOpen },
  { id: 'tarefas', label: 'Eventos', icon: CalendarDays },
  { id: 'prazos', label: 'Prazos', icon: Clock },
  { id: 'honorarios', label: 'Honorários', icon: DollarSign },
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
  const [changingStage, setChangingStage] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [showTrackingModal, setShowTrackingModal] = useState(false);
  const [trackingCaseNumber, setTrackingCaseNumber] = useState('');
  const [trackingCourt, setTrackingCourt] = useState('');
  const [sendingToTracking, setSendingToTracking] = useState(false);

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

  // ─── Stage / Archive / Tracking handlers ─────────────────

  const handleStageChange = async (newStage: string) => {
    setChangingStage(true);
    try {
      if (data.in_tracking) {
        await api.patch(`/legal-cases/${caseId}/tracking-stage`, { trackingStage: newStage });
      } else {
        await api.patch(`/legal-cases/${caseId}/stage`, { stage: newStage });
      }
      showSuccess('Etapa atualizada');
      fetchWorkspace();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao alterar etapa');
    } finally {
      setChangingStage(false);
    }
  };

  const handleSendToTracking = async () => {
    if (!trackingCaseNumber.trim()) return;
    setSendingToTracking(true);
    try {
      await api.patch(`/legal-cases/${caseId}/send-to-tracking`, {
        caseNumber: trackingCaseNumber.trim(),
        court: trackingCourt.trim() || undefined,
      });
      showSuccess('Caso protocolado e enviado para acompanhamento');
      setShowTrackingModal(false);
      setTrackingCaseNumber('');
      setTrackingCourt('');
      fetchWorkspace();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao protocolar');
    } finally {
      setSendingToTracking(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await api.patch(`/legal-cases/${caseId}/archive`, {
        reason: archiveReason.trim() || 'Sem motivo informado',
      });
      showSuccess('Caso arquivado');
      setShowArchiveModal(false);
      setArchiveReason('');
      fetchWorkspace();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao arquivar');
    } finally {
      setArchiving(false);
    }
  };

  const handleUnarchive = async () => {
    try {
      await api.patch(`/legal-cases/${caseId}/unarchive`);
      showSuccess('Caso desarquivado');
      fetchWorkspace();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao desarquivar');
    }
  };

  const handleRenounce = async () => {
    try {
      await api.patch(`/legal-cases/${caseId}/renounce`);
      showSuccess('Renúncia registrada — publicações DJEN serão auto-arquivadas');
      fetchWorkspace();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao renunciar');
    }
  };

  const handleUnrenounce = async () => {
    try {
      await api.patch(`/legal-cases/${caseId}/unrenounce`);
      showSuccess('Renúncia desfeita');
      fetchWorkspace();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao desfazer renúncia');
    }
  };

  const clientName = data.lead?.name || 'Cliente sem nome';
  const stageLabel = data.in_tracking ? (data.tracking_stage || data.stage) : data.stage;
  const currentStages = data.in_tracking ? TRACKING_STAGES : LEGAL_STAGES;
  const currentStageValue = data.in_tracking ? (data.tracking_stage || '') : data.stage;

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
            {data.renounced && (
              <span className="badge badge-error badge-sm whitespace-nowrap gap-1">
                <Ban className="h-3 w-3" /> Renunciado
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
            <select
              className="select select-xs select-bordered select-primary font-medium h-5 min-h-0"
              value={currentStageValue}
              onChange={(e) => handleStageChange(e.target.value)}
              disabled={changingStage || data.archived}
            >
              {currentStages.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            {data.in_tracking && (
              <span className="badge badge-xs badge-info">Em acompanhamento</span>
            )}
            <span className="text-base-content/30">•</span>
            <span>Adv: {data.lawyer.name}</span>
          </div>
        </div>

        {/* Header action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {!data.in_tracking && data.stage === 'PROTOCOLO' && !data.archived && (
            <button
              onClick={() => setShowTrackingModal(true)}
              className="btn btn-xs btn-outline btn-success gap-1"
              title="Protocolar e enviar para acompanhamento"
            >
              <Send className="h-3 w-3" />
              Protocolar
            </button>
          )}

          {data.archived ? (
            <button
              onClick={handleUnarchive}
              className="btn btn-xs btn-outline btn-info gap-1"
              title="Desarquivar caso"
            >
              <ArchiveRestore className="h-3 w-3" />
              Desarquivar
            </button>
          ) : (
            <button
              onClick={() => setShowArchiveModal(true)}
              className="btn btn-xs btn-outline btn-warning gap-1"
              title="Arquivar caso"
            >
              <Archive className="h-3 w-3" />
              Arquivar
            </button>
          )}

          {data.renounced ? (
            <button
              onClick={handleUnrenounce}
              className="btn btn-xs btn-outline btn-info gap-1"
              title="Desfazer renúncia"
            >
              <Undo2 className="h-3 w-3" />
              Desfazer renúncia
            </button>
          ) : (
            <button
              onClick={handleRenounce}
              className="btn btn-xs btn-outline btn-error gap-1"
              title="Marcar que não é mais advogado deste processo — publicações DJEN serão auto-arquivadas"
            >
              <Ban className="h-3 w-3" />
              Renunciar
            </button>
          )}
        </div>
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
          {activeTab === 'peticoes' && (
            <TabPeticoes caseId={caseId} />
          )}
          {activeTab === 'banco' && (
            <TabBancoPecas
              caseId={caseId}
              onUsePetition={() => setActiveTab('peticoes')}
            />
          )}
          {activeTab === 'tarefas' && (
            <TabTarefas caseId={caseId} lawyerId={data.lawyer_id} />
          )}
          {activeTab === 'prazos' && (
            <TabPrazos caseId={caseId} />
          )}
          {activeTab === 'honorarios' && (
            <TabHonorarios caseId={caseId} />
          )}
          {activeTab === 'comunicacoes' && (
            <TabComunicacoes caseId={caseId} />
          )}
          {activeTab === 'timeline' && (
            <TabTimeline caseId={caseId} />
          )}
        </main>
      </div>

      {/* Archive Modal */}
      {showArchiveModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-bold text-lg">Arquivar Caso</h3>
            <p className="text-sm text-base-content/60 mt-2">
              Informe o motivo do arquivamento:
            </p>
            <textarea
              className="textarea textarea-bordered w-full mt-3"
              placeholder="Motivo do arquivamento..."
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              rows={3}
            />
            <div className="modal-action">
              <button onClick={() => setShowArchiveModal(false)} className="btn btn-ghost btn-sm">
                Cancelar
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="btn btn-warning btn-sm gap-1"
              >
                {archiving && <Loader2 className="h-4 w-4 animate-spin" />}
                Arquivar
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowArchiveModal(false)} />
        </div>
      )}

      {/* Send to Tracking Modal */}
      {showTrackingModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-bold text-lg">Protocolar / Enviar para Acompanhamento</h3>
            <div className="space-y-3 mt-4">
              <div>
                <label className="label text-xs">Número do Processo *</label>
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="Ex: 0000123-45.2024.5.19.0001"
                  value={trackingCaseNumber}
                  onChange={(e) => setTrackingCaseNumber(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="label text-xs">Vara / Tribunal</label>
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="Ex: 1ª Vara do Trabalho de Maceió"
                  value={trackingCourt}
                  onChange={(e) => setTrackingCourt(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-action">
              <button onClick={() => setShowTrackingModal(false)} className="btn btn-ghost btn-sm">
                Cancelar
              </button>
              <button
                onClick={handleSendToTracking}
                disabled={!trackingCaseNumber.trim() || sendingToTracking}
                className="btn btn-success btn-sm gap-1"
              >
                {sendingToTracking && <Loader2 className="h-4 w-4 animate-spin" />}
                Protocolar
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowTrackingModal(false)} />
        </div>
      )}
    </div>
  );
}
