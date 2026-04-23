'use client';

import { useCallback, useEffect, useState } from 'react';
import { AudioLines, Upload, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';
import type { TranscricaoListItem } from '@/components/transcricoes/types';
import { TranscricaoCard } from '@/components/transcricoes/TranscricaoCard';
import { TranscricaoViewer } from '@/components/transcricoes/TranscricaoViewer';
import { NovaTranscricaoWizard } from '@/components/transcricoes/NovaTranscricaoWizard';

/**
 * Aba Transcrições dentro do workspace de um processo.
 * Lista apenas as transcrições daquele caso. Upload já vem com o caseId
 * pré-selecionado no wizard — o advogado só precisa escolher o arquivo.
 */
export default function TabTranscricoes({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<TranscricaoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const r = await api.get(`/transcriptions?caseId=${caseId}`);
      setItems(r.data);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao carregar transcrições');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { fetchList(); }, [fetchList]);

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

  if (selectedId) {
    return (
      <TranscricaoViewer id={selectedId} onBack={() => { setSelectedId(null); fetchList(); }} />
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-base-content flex items-center gap-2">
            <AudioLines className="h-5 w-5 text-primary" /> Transcrições de Audiência
          </h2>
          <p className="text-sm text-base-content/60 mt-1">
            Upload de vídeo (ASF/MP4/etc.) → conversão → transcrição com separação de falantes
          </p>
        </div>
        <button onClick={() => setWizardOpen(true)} className="btn btn-primary btn-sm gap-2">
          <Upload className="h-4 w-4" /> Nova transcrição
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-lg">
          <AudioLines className="h-10 w-10 mx-auto text-base-content/30" />
          <p className="mt-4 text-base-content/60">Nenhuma transcrição ainda</p>
          <p className="text-sm text-base-content/40 mt-1">
            Arquivos aceitos: ASF, WMV, MP4, MKV, MOV, WEBM, MP3, WAV... (até 3GB)
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <TranscricaoCard
              key={t.id}
              item={t}
              onOpen={() => setSelectedId(t.id)}
              onDelete={() => handleDelete(t.id)}
              onRetry={() => handleRetry(t.id)}
            />
          ))}
        </div>
      )}

      {/* Wizard abre já com o caseId pré-selecionado */}
      <NovaTranscricaoWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => fetchList()}
        prefilledCaseId={caseId}
      />
    </div>
  );
}
