'use client';

import { useState } from 'react';
import { Save, Loader2, Gavel, Scale, UserX, User, FileText, Brain, MapPin, Sparkles, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface WorkspaceData {
  id: string;
  case_number: string | null;
  legal_area: string | null;
  stage: string;
  in_tracking: boolean;
  tracking_stage: string | null;
  notes: string | null;
  court: string | null;
  action_type: string | null;
  claim_value: number | null;
  opposing_party: string | null;
  judge: string | null;
  created_at: string;
  updated_at: string;
  lead: {
    name: string | null;
    phone: string;
    email: string | null;
    memory: { summary: string; facts_json: any } | null;
    ficha_trabalhista: { data: any; completion_pct: number; finalizado: boolean } | null;
  };
  lawyer: { id: string; name: string; email: string };
}

export default function TabResumo({
  data,
  onRefresh,
}: {
  data: WorkspaceData;
  onRefresh: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);

  const handleGenerateBriefing = async () => {
    setGeneratingBriefing(true);
    try {
      const res = await api.post(`/legal-cases/${data.id}/briefing`);
      setBriefing(res.data.briefing);
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao gerar briefing');
    } finally {
      setGeneratingBriefing(false);
    }
  };
  const [actionType, setActionType] = useState(data.action_type || '');
  const [claimValue, setClaimValue] = useState(data.claim_value?.toString() || '');
  const [opposingParty, setOpposingParty] = useState(data.opposing_party || '');
  const [judge, setJudge] = useState(data.judge || '');
  const [notes, setNotes] = useState(data.notes || '');
  const [court, setCourt] = useState(data.court || '');
  const [legalArea, setLegalArea] = useState(data.legal_area || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/legal-cases/${data.id}/details`, {
        action_type: actionType || null,
        claim_value: claimValue ? parseFloat(claimValue) : null,
        opposing_party: opposingParty || null,
        judge: judge || null,
        notes: notes || null,
        court: court || null,
        legal_area: legalArea || null,
      });
      showSuccess('Dados salvos');
      onRefresh();
    } catch (e: any) {
      showError(e?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const memory = data.lead?.memory;
  const ficha = data.lead?.ficha_trabalhista;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Dados do Caso */}
      <section>
        <h2 className="text-base font-semibold text-base-content mb-4 flex items-center gap-2">
          <Gavel className="h-4 w-4 text-primary" />
          Dados do Caso
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label text-xs font-medium">Área Jurídica</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              placeholder="Ex: Trabalhista, Civil, Previdenciário"
              value={legalArea}
              onChange={(e) => setLegalArea(e.target.value)}
            />
          </div>
          <div>
            <label className="label text-xs font-medium">Tipo de Ação</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              placeholder="Ex: Reclamatória Trabalhista"
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
            />
          </div>
          <div>
            <label className="label text-xs font-medium">Valor da Causa (R$)</label>
            <input
              type="number"
              step="0.01"
              className="input input-bordered input-sm w-full"
              placeholder="0,00"
              value={claimValue}
              onChange={(e) => setClaimValue(e.target.value)}
            />
          </div>
          <div>
            <label className="label text-xs font-medium">Vara / Tribunal</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              placeholder="Ex: 1ª Vara do Trabalho de Maceió"
              value={court}
              onChange={(e) => setCourt(e.target.value)}
            />
          </div>
          <div>
            <label className="label text-xs font-medium flex items-center gap-1">
              <UserX className="h-3 w-3" /> Parte Contrária
            </label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              placeholder="Nome da parte contrária"
              value={opposingParty}
              onChange={(e) => setOpposingParty(e.target.value)}
            />
          </div>
          <div>
            <label className="label text-xs font-medium flex items-center gap-1">
              <Scale className="h-3 w-3" /> Juiz / Desembargador
            </label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              placeholder="Nome do juiz"
              value={judge}
              onChange={(e) => setJudge(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Observações */}
      <section>
        <h2 className="text-base font-semibold text-base-content mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Observações
        </h2>
        <textarea
          className="textarea textarea-bordered w-full min-h-[120px] text-sm"
          placeholder="Notas sobre o caso..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary btn-sm gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar alterações
        </button>
      </div>

      {/* Dados do Cliente */}
      <section>
        <h2 className="text-base font-semibold text-base-content mb-4 flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          Dados do Cliente
        </h2>
        <div className="bg-base-200/50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-base-content/60">Nome</span>
            <span className="font-medium">{data.lead.name || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base-content/60">Telefone</span>
            <span className="font-medium">{data.lead.phone}</span>
          </div>
          {data.lead.email && (
            <div className="flex justify-between">
              <span className="text-base-content/60">Email</span>
              <span className="font-medium">{data.lead.email}</span>
            </div>
          )}
        </div>
      </section>

      {/* IA Memory */}
      {memory && (
        <section>
          <h2 className="text-base font-semibold text-base-content mb-4 flex items-center gap-2">
            <Brain className="h-4 w-4 text-secondary" />
            Resumo da IA
          </h2>
          <div className="bg-secondary/5 border border-secondary/20 rounded-lg p-4 text-sm whitespace-pre-line">
            {memory.summary}
          </div>
        </section>
      )}

      {/* Briefing IA */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            Briefing IA
          </h2>
          <button
            onClick={handleGenerateBriefing}
            disabled={generatingBriefing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {generatingBriefing
              ? <><Loader2 size={12} className="animate-spin" /> Gerando...</>
              : briefing
              ? <><RefreshCw size={12} /> Regenerar</>
              : <><Sparkles size={12} /> Gerar Briefing IA</>}
          </button>
        </div>

        {generatingBriefing && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-2 animate-pulse">
            <div className="h-3 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-5/6" />
            <div className="h-3 bg-muted rounded w-2/3" />
          </div>
        )}

        {briefing && !generatingBriefing && (
          <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {briefing}
          </div>
        )}

        {!briefing && !generatingBriefing && (
          <p className="text-xs text-muted-foreground">
            Clique em "Gerar Briefing IA" para receber um resumo estruturado do caso com situação atual, próximos passos e pontos de atenção.
          </p>
        )}
      </section>

      {/* Ficha Trabalhista */}
      {ficha && (
        <section>
          <h2 className="text-base font-semibold text-base-content mb-4 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-accent" />
            Ficha Trabalhista
            <span className="badge badge-xs badge-accent">{ficha.completion_pct}%</span>
            {ficha.finalizado && <span className="badge badge-xs badge-success">Finalizada</span>}
          </h2>
          <div className="bg-base-200/50 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {Object.entries(ficha.data as Record<string, any>)
                .filter(([, v]) => v != null && v !== '')
                .slice(0, 20)
                .map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <span className="text-base-content/60 truncate">{key.replace(/_/g, ' ')}</span>
                    <span className="font-medium text-right truncate max-w-[200px]">
                      {String(value)}
                    </span>
                  </div>
                ))}
            </div>
            {Object.keys(ficha.data as Record<string, any>).length > 20 && (
              <p className="text-xs text-base-content/40 mt-2">
                ...e mais {Object.keys(ficha.data as Record<string, any>).length - 20} campos
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
