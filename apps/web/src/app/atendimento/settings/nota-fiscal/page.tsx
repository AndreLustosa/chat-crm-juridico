'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Save, Loader2, Check, AlertTriangle, ExternalLink, ToggleLeft, ToggleRight } from 'lucide-react';
import api from '@/lib/api';

const PROVIDERS = [
  { id: 'enotas', label: 'eNotas', url: 'https://enotas.com.br' },
  { id: 'nfeio', label: 'NFe.io', url: 'https://nfe.io' },
  { id: 'focusnfe', label: 'FocusNFe', url: 'https://focusnfe.com.br' },
];

export default function NotaFiscalSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [provider, setProvider] = useState('enotas');
  const [apiKey, setApiKey] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('');
  const [cnaeCode, setCnaeCode] = useState('6911-7/01');
  const [issRate, setIssRate] = useState('5.00');
  const [autoEmit, setAutoEmit] = useState(false);
  const [servicoDescricao, setServicoDescricao] = useState('Serviços advocatícios');
  const [status, setStatus] = useState<{ configured: boolean; provider: string; autoEmit: boolean } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/atendimento/login'); return; }
    api.get('/nota-fiscal/config')
      .then(r => {
        setStatus(r.data);
        if (r.data?.provider) setProvider(r.data.provider);
        if (r.data?.autoEmit !== undefined) setAutoEmit(r.data.autoEmit);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const settings: Record<string, string> = {
        nfse_provider: provider,
        nfse_cnpj: cnpj,
        nfse_inscricao_municipal: inscricaoMunicipal,
        nfse_cnae_code: cnaeCode,
        nfse_default_iss_rate: issRate,
        nfse_auto_emit: autoEmit ? 'true' : 'false',
        nfse_servico_descricao: servicoDescricao,
      };
      if (apiKey.trim()) settings.nfse_api_key = apiKey.trim();

      for (const [key, value] of Object.entries(settings)) {
        await api.put('/settings', { key, value });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      const res = await api.get('/nota-fiscal/config');
      setStatus(res.data);
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-violet-500/15 flex items-center justify-center">
          <FileText className="w-6 h-6 text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Nota Fiscal Eletrônica (NFS-e)</h1>
          <p className="text-sm text-muted-foreground">Emissão automática de notas fiscais de serviço</p>
        </div>
      </div>

      {/* Status */}
      <div className={`p-4 rounded-xl border ${status?.configured ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
        <div className="flex items-center gap-2">
          {status?.configured ? <Check className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-amber-400" />}
          <span className="font-semibold text-sm">
            {status?.configured ? 'Configurado' : 'Não configurado'}
          </span>
          {status?.autoEmit && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">Auto-emissão ativa</span>}
        </div>
      </div>

      {/* Form */}
      <div className="space-y-5">
        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">Provedor NFS-e</label>
          <div className="grid grid-cols-3 gap-2">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`p-3 rounded-xl border text-center transition-all ${provider === p.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent/30 text-muted-foreground'}`}
              >
                <p className="text-sm font-semibold">{p.label}</p>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 mt-0.5" onClick={e => e.stopPropagation()}>
                  Site <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">API Key do {PROVIDERS.find(p => p.id === provider)?.label}</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={status?.configured ? '••••••••••• (já configurada)' : 'Cole sua API key aqui'}
            className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">CNPJ do Escritório</label>
            <input
              type="text"
              value={cnpj}
              onChange={e => setCnpj(e.target.value)}
              placeholder="00.000.000/0001-00"
              className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Inscrição Municipal</label>
            <input
              type="text"
              value={inscricaoMunicipal}
              onChange={e => setInscricaoMunicipal(e.target.value)}
              placeholder="Nº inscrição municipal"
              className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Código CNAE</label>
            <input
              type="text"
              value={cnaeCode}
              onChange={e => setCnaeCode(e.target.value)}
              placeholder="6911-7/01"
              className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Alíquota ISS (%)</label>
            <input
              type="number"
              step="0.01"
              value={issRate}
              onChange={e => setIssRate(e.target.value)}
              placeholder="5.00"
              className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">Descrição do Serviço</label>
          <input
            type="text"
            value={servicoDescricao}
            onChange={e => setServicoDescricao(e.target.value)}
            placeholder="Serviços advocatícios"
            className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <button
          onClick={() => setAutoEmit(!autoEmit)}
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border hover:bg-accent/30 transition-colors w-full"
        >
          {autoEmit ? <ToggleRight className="h-5 w-5 text-emerald-400" /> : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
          <div className="text-left">
            <p className="text-sm font-medium">Emissão Automática</p>
            <p className="text-xs text-muted-foreground">
              {autoEmit ? 'NFS-e será emitida automaticamente ao receber pagamento' : 'NFS-e deve ser emitida manualmente'}
            </p>
          </div>
        </button>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 text-sm font-semibold bg-primary text-primary-foreground rounded-xl hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? 'Salvo!' : 'Salvar Configuração'}
        </button>
      </div>
    </div>
  );
}
