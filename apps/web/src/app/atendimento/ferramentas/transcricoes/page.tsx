'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AudioLines, Upload, Loader2, ArrowLeft, RefreshCw,
} from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import type { TranscricaoListItem } from '@/components/transcricoes/types';
import { TranscricaoCard } from '@/components/transcricoes/TranscricaoCard';
import { TranscricaoViewer } from '@/components/transcricoes/TranscricaoViewer';
import { NovaTranscricaoWizard } from '@/components/transcricoes/NovaTranscricaoWizard';

type Scope = 'all' | 'avulsas' | 'linked';

export default function TranscricoesFerramentaPage() {
  const [items, setItems] = useState<TranscricaoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const r = await api.get(`/transcriptions`, {
        params: { scope, mine: mineOnly ? 'true' : undefined },
      });
      setItems(r.data);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao carregar transcrições');
    } finally {
      setLoading(false);
    }
  }, [scope, mineOnly]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Polling enquanto há jobs ativos
  useEffect(() => {
    const hasActive = items.some((i) => i.status !== 'DONE' && i.status !== 'ERROR');
    if (!hasActive) return;
    const t = setInterval(fetchList, 8000);
    return () => clearInterval(t);
  }, [items, fetchList]);

  const handleDelete = async (id: string) => {
    if (!confirm('Deletar esta transcrição? O vídeo e o texto serão perdidos.')) return;
    try {
      await api.delete(`/transcriptions/${id}`);
      showSuccess('Transcrição deletada');
      fetchList();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao deletar');
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await api.post(`/transcriptions/${id}/retry`);
      showSuccess('Reenfileirada para processamento');
      fetchList();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao reprocessar');
    }
  };

  // Quando está com um item aberto, viewer ocupa a tela
  if (selectedId) {
    return (
      <div className="h-screen flex flex-col">
        <TranscricaoViewer id={selectedId} onBack={() => { setSelectedId(null); fetchList(); }} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/atendimento/ferramentas"
            className="text-xs text-base-content/60 hover:text-primary flex items-center gap-1 mb-1"
          >
            <ArrowLeft className="h-3 w-3" /> Ferramentas
          </Link>
          <h1 className="text-2xl font-semibold text-base-content flex items-center gap-2">
            <AudioLines className="h-6 w-6 text-violet-400" /> Transcrição de Audiência
          </h1>
          <p className="text-sm text-base-content/60 mt-1">
            Upload de vídeo → conversão → transcrição com separação de falantes.
            Vincule ao processo pra IA usar no briefing, ou use avulsa.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchList} className="btn btn-ghost btn-sm" title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => setWizardOpen(true)} className="btn btn-primary btn-sm gap-2">
            <Upload className="h-4 w-4" /> Nova transcrição
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="join">
          <button
            onClick={() => setScope('all')}
            className={`join-item btn btn-sm ${scope === 'all' ? 'btn-primary' : ''}`}
          >
            Todas
          </button>
          <button
            onClick={() => setScope('linked')}
            className={`join-item btn btn-sm ${scope === 'linked' ? 'btn-primary' : ''}`}
          >
            Vinculadas
          </button>
          <button
            onClick={() => setScope('avulsas')}
            className={`join-item btn btn-sm ${scope === 'avulsas' ? 'btn-primary' : ''}`}
          >
            Avulsas
          </button>
        </div>
        <label className="cursor-pointer flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          Só minhas
        </label>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-lg">
          <AudioLines className="h-10 w-10 mx-auto text-base-content/30" />
          <p className="mt-4 text-base-content/60">
            {scope === 'avulsas' ? 'Nenhuma transcrição avulsa' :
             scope === 'linked' ? 'Nenhuma transcrição vinculada a processo' :
             'Nenhuma transcrição ainda'}
          </p>
          <p className="text-sm text-base-content/40 mt-1">
            Arquivos aceitos: ASF, WMV, MP4, MKV, MOV, WEBM, MP3, WAV... (até 3GB)
          </p>
          <button onClick={() => setWizardOpen(true)} className="btn btn-primary btn-sm gap-2 mt-4">
            <Upload className="h-4 w-4" /> Criar primeira transcrição
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <TranscricaoCard
              key={t.id}
              item={t}
              showLink
              onOpen={() => setSelectedId(t.id)}
              onDelete={() => handleDelete(t.id)}
              onRetry={() => handleRetry(t.id)}
            />
          ))}
        </div>
      )}

      <NovaTranscricaoWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => fetchList()}
      />
    </div>
  );
}
