'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, X, Send, AlertCircle, CheckCircle2,
  Loader2, ChevronDown, ChevronUp, Download, PenLine, Copy, Check as CheckIcon,
  Clock, FileCheck2,
} from 'lucide-react';
import api from '@/lib/api';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ContratoVariaveis {
  NOME_CONTRATANTE: string;
  NACIONALIDADE: string;
  ESTADO_CIVIL: string;
  DATA_NASCIMENTO: string;
  NOME_MAE: string;
  NOME_PAI: string;
  CPF: string;
  ENDERECO: string;
  BAIRRO: string;
  CEP: string;
  CIDADE_UF: string;
  PERCENTUAL: number;
  PERCENTUAL_EXTENSO: string;
  DESCRICAO_CAUSA: string;
  DATA_CONTRATO: string;
  CIDADE_CONTRATO: string;
}

interface Props {
  open: boolean;
  conversationId: string | null;
  onClose: () => void;
}

// ─── Campos exibidos no formulário ───────────────────────────────────────────

const CAMPOS: Array<{
  key: keyof ContratoVariaveis;
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'textarea';
}> = [
  { key: 'NOME_CONTRATANTE',  label: 'Nome completo do cliente',       required: true },
  { key: 'CPF',               label: 'CPF',                            required: true },
  { key: 'NACIONALIDADE',     label: 'Nacionalidade',                  required: true },
  { key: 'ESTADO_CIVIL',      label: 'Estado civil',                   required: true },
  { key: 'DATA_NASCIMENTO',   label: 'Data de nascimento (extenso)',   required: true },
  { key: 'NOME_MAE',          label: 'Nome da mãe',                    required: true },
  { key: 'NOME_PAI',          label: 'Nome do pai',                    required: true },
  { key: 'ENDERECO',          label: 'Endereço (rua e número)',        required: true },
  { key: 'BAIRRO',            label: 'Bairro',                         required: true },
  { key: 'CEP',               label: 'CEP',                            required: true },
  { key: 'CIDADE_UF',         label: 'Cidade – UF',                    required: true },
  { key: 'PERCENTUAL',        label: 'Honorários (%)',                 required: true, type: 'number' },
  { key: 'DESCRICAO_CAUSA',   label: 'Descrição da causa',             required: true, type: 'textarea' },
  { key: 'DATA_CONTRATO',     label: 'Data do contrato',               required: true },
  { key: 'CIDADE_CONTRATO',   label: 'Cidade do contrato',             required: true },
];

const PCT_EXTENSO: Record<number, string> = {
  5: 'cinco', 10: 'dez', 15: 'quinze', 20: 'vinte',
  25: 'vinte e cinco', 30: 'trinta', 35: 'trinta e cinco', 40: 'quarenta',
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ContratoTrabalhistaModal({ open, conversationId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variaveis, setVariaveis] = useState<ContratoVariaveis | null>(null);
  const [camposFaltando, setCamposFaltando] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  // Assinatura digital
  const [signingState, setSigningState] = useState<'idle' | 'loading' | 'sent'>('idle');
  const [signingUrl, setSigningUrl] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  // Status de assinatura existente
  type SignatureStatus = {
    id: string;
    status: string;           // PENDENTE | ASSINADO | CANCELADO | EXPIRADO | ERRO_BIOMETRIA
    signing_url: string | null;
    signed_at: string | null;
    created_at: string;
    has_pdf: boolean;         // PDF já salvo no S3
    dashboard_url: string | null; // URL do painel Clicksign
  };
  const [existingSignature, setExistingSignature] = useState<SignatureStatus | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Carregar preview + status de assinatura ao abrir
  useEffect(() => {
    if (!open || !conversationId) return;
    setSent(false);
    setError(null);
    setSigningState('idle');
    setSigningUrl(null);
    setUrlCopied(false);
    setExistingSignature(null);
    setLoading(true);

    Promise.all([
      api.get(`/contracts/trabalhista/preview?conversationId=${conversationId}`),
      api.get(`/contracts/clicksign/status/${conversationId}`).catch(() => ({ data: null })),
    ])
      .then(([previewRes, statusRes]) => {
        setVariaveis(previewRes.data.variaveis);
        setCamposFaltando(previewRes.data.camposFaltando || []);
        if (statusRes.data) setExistingSignature(statusRes.data);
      })
      .catch(() => setError('Não foi possível carregar os dados do contrato.'))
      .finally(() => setLoading(false));
  }, [open, conversationId]);

  const handleDownloadSignedPdf = async () => {
    if (!existingSignature) return;
    setDownloadingPdf(true);
    setError(null);
    try {
      const res = await api.get(`/contracts/clicksign/signed-pdf/${existingSignature.id}`, {
        responseType: 'blob',
      });
      // Se o servidor retornou um blob de JSON de erro (axios + blob)
      const blob = new Blob([res.data], { type: res.headers['content-type'] || 'application/pdf' });
      if (blob.type.includes('application/json')) {
        const text = await blob.text();
        const parsed = JSON.parse(text);
        throw new Error(parsed?.message || 'Erro ao baixar PDF');
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Contrato_Assinado_${variaveis?.NOME_CONTRATANTE?.split(' ')[0] || 'cliente'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      // Com responseType:'blob', e.response.data é um Blob — precisamos ler o texto
      let msg = 'Erro ao baixar o PDF assinado.';
      try {
        if (e?.response?.data instanceof Blob) {
          const text = await (e.response.data as Blob).text();
          const parsed = JSON.parse(text);
          msg = parsed?.message || msg;
        } else {
          msg = e?.response?.data?.message || e?.message || msg;
        }
      } catch {}
      setError(msg);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleChange = (key: keyof ContratoVariaveis, value: string | number) => {
    setVariaveis((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [key]: value };
      if (key === 'PERCENTUAL') {
        updated.PERCENTUAL_EXTENSO = PCT_EXTENSO[Number(value)] || String(value);
      }
      return updated;
    });
  };

  const handleSend = async () => {
    if (!conversationId || !variaveis) return;
    setSending(true);
    setError(null);
    try {
      await api.post('/contracts/trabalhista/send', { conversationId, variaveis });
      setSent(true);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erro ao enviar contrato.');
    } finally {
      setSending(false);
    }
  };

  const handleDownload = async () => {
    if (!variaveis) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await api.post('/contracts/trabalhista/download', { variaveis }, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      const clientName = variaveis.NOME_CONTRATANTE.split(' ')[0] || 'contrato';
      a.href = url;
      a.download = `Contrato_Trabalhista_${clientName}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Erro ao gerar o arquivo para download.');
    } finally {
      setDownloading(false);
    }
  };

  const handleRequestSignature = async () => {
    if (!conversationId || !variaveis) return;
    setSigningState('loading');
    setError(null);
    try {
      const res = await api.post('/contracts/clicksign/request', {
        conversationId,
        variaveis,
      });
      setSigningUrl(res.data.signingUrl);
      setSigningState('sent');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Erro ao solicitar assinatura digital.');
      setSigningState('idle');
    }
  };

  const handleCopyUrl = async () => {
    if (!signingUrl) return;
    await navigator.clipboard.writeText(signingUrl).catch(() => {});
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-white/10 bg-[#111] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <FileText className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Contrato Trabalhista</h2>
                  <p className="text-xs text-slate-400">
                    Preencha os campos e envie por WhatsApp
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {/* Loading */}
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
                </div>
              )}

              {/* Enviado (DOCX via WhatsApp) */}
              {sent && (
                <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <CheckCircle2 className="h-9 w-9 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-white">Contrato enviado!</p>
                    <p className="text-sm text-slate-400 mt-1">
                      O arquivo .docx foi enviado via WhatsApp.
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="mt-2 px-6 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/20 transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              )}

              {/* Painel de status de assinatura existente */}
              {!loading && !sent && existingSignature && (
                <div className={`rounded-xl border p-4 space-y-2 ${
                  existingSignature.status === 'ASSINADO'
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : existingSignature.status === 'ERRO_BIOMETRIA'
                    ? 'border-red-500/30 bg-red-500/10'
                    : 'border-amber-500/30 bg-amber-500/10'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      {existingSignature.status === 'ASSINADO' ? (
                        <><FileCheck2 className="h-4 w-4 text-emerald-400 shrink-0" />
                          <span className="text-emerald-400">Contrato assinado digitalmente ✅</span></>
                      ) : existingSignature.status === 'ERRO_BIOMETRIA' ? (
                        <><AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                          <span className="text-red-400">Erro na verificação biométrica</span></>
                      ) : (
                        <><Clock className="h-4 w-4 text-amber-400 shrink-0 animate-pulse" />
                          <span className="text-amber-400">Aguardando assinatura do cliente…</span></>
                      )}
                    </div>
                    {existingSignature.signed_at && (
                      <span className="text-[11px] text-slate-500 shrink-0">
                        {new Date(existingSignature.signed_at).toLocaleString('pt-BR')}
                      </span>
                    )}
                  </div>

                  {/* Botões de download do PDF assinado */}
                  {existingSignature.status === 'ASSINADO' && (
                    <button
                      onClick={handleDownloadSignedPdf}
                      disabled={downloadingPdf}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 disabled:opacity-60 transition-colors"
                    >
                      {downloadingPdf
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Baixando…</>
                        : <><Download className="h-3.5 w-3.5" /> Baixar PDF assinado</>
                      }
                    </button>
                  )}

                  {/* Link de assinatura se pendente */}
                  {existingSignature.status !== 'ASSINADO' && existingSignature.signing_url && (
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={existingSignature.signing_url}
                        className="flex-1 rounded-lg border border-white/10 bg-black/30 text-slate-400 text-xs px-2 py-1 focus:outline-none truncate"
                      />
                      <button
                        onClick={() => navigator.clipboard.writeText(existingSignature.signing_url!).catch(() => {})}
                        className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-400 text-xs hover:bg-white/10 transition-colors shrink-0"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Campos */}
              {!loading && !sent && variaveis && (
                <>
                  {/* Aviso de campos faltando */}
                  {camposFaltando.length > 0 && (
                    <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-400">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>
                        <strong>Campos não encontrados na ficha:</strong>{' '}
                        {camposFaltando.join(', ')}. Preencha manualmente abaixo.
                      </span>
                    </div>
                  )}

                  {/* Banner: link de assinatura enviado */}
                  {signingState === 'sent' && signingUrl && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm text-emerald-400 font-semibold">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        Link de assinatura enviado por WhatsApp ao cliente!
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={signingUrl}
                          className="flex-1 rounded-lg border border-white/10 bg-black/30 text-slate-300 text-xs px-3 py-1.5 focus:outline-none truncate"
                        />
                        <button
                          onClick={handleCopyUrl}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-400 text-xs hover:bg-white/10 transition-colors shrink-0"
                        >
                          {urlCopied
                            ? <><CheckIcon className="h-3 w-3 text-emerald-400" /> Copiado</>
                            : <><Copy className="h-3 w-3" /> Copiar</>
                          }
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Assinatura via SMS + Selfie · Válida juridicamente (Lei 14.063/2020)
                      </p>
                    </div>
                  )}

                  {/* Grid de campos */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {CAMPOS.map(({ key, label, required, type }) => (
                      <div key={key} className={type === 'textarea' ? 'sm:col-span-2' : ''}>
                        <label className="block text-[11px] font-bold uppercase tracking-widest text-amber-500/80 mb-1">
                          {label}
                          {required && <span className="text-red-400 ml-0.5">*</span>}
                        </label>
                        {type === 'textarea' ? (
                          <textarea
                            rows={2}
                            value={String(variaveis[key])}
                            onChange={(e) => handleChange(key, e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 text-white text-sm px-3 py-2 focus:outline-none focus:border-amber-500 transition-colors resize-none"
                          />
                        ) : (
                          <input
                            type={type || 'text'}
                            value={String(variaveis[key])}
                            onChange={(e) =>
                              handleChange(
                                key,
                                type === 'number' ? Number(e.target.value) : e.target.value,
                              )
                            }
                            className="w-full rounded-lg border border-white/10 bg-white/5 text-white text-sm px-3 py-2 focus:outline-none focus:border-amber-500 transition-colors"
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Preview das partes fixas */}
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={() => setShowPreview((v) => !v)}
                      className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showPreview ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      Partes fixas do contrato
                    </button>
                    {showPreview && (
                      <div className="mt-2 rounded-xl border border-white/5 bg-white/3 p-3 text-xs text-slate-400 leading-relaxed space-y-1">
                        <p>
                          <strong className="text-slate-300">Contratados:</strong> André Freire Lustosa
                          (OAB/AL 14.209) e Gianny Karla Oliveira Silva (OAB/AL 21.897)
                        </p>
                        <p>
                          <strong className="text-slate-300">Escritório:</strong> Rua Francisco Rodrigues
                          Viana, nº 242, Baixa Grande, Arapiraca/AL, CEP 57307-260
                        </p>
                        <p>
                          <strong className="text-slate-300">Recurso 2ª instância:</strong> Não incluso —
                          necessita novo contrato
                        </p>
                        <p>
                          <strong className="text-slate-300">Foro:</strong> Arapiraca/AL
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Erro */}
              {error && !sent && (
                <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            {!loading && !sent && variaveis && (
              <div className="flex flex-wrap items-center justify-between px-6 py-4 border-t border-white/10 gap-2">
                {/* Esquerda: cancelar */}
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm font-semibold hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>

                {/* Direita: ações */}
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {/* Baixar DOCX */}
                  <button
                    onClick={handleDownload}
                    disabled={downloading || sending || signingState === 'loading'}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-400 text-sm font-semibold hover:bg-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    title="Baixar .docx no PC"
                  >
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Baixar
                  </button>

                  {/* Solicitar assinatura digital */}
                  <button
                    onClick={handleRequestSignature}
                    disabled={signingState === 'loading' || sending}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-300 text-sm font-semibold hover:bg-violet-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    title="Enviar link de assinatura digital Clicksign via WhatsApp"
                  >
                    {signingState === 'loading' ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Preparando…</>
                    ) : signingState === 'sent' ? (
                      <><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Assinatura enviada</>
                    ) : (
                      <><PenLine className="h-4 w-4" /> Solicitar Assinatura</>
                    )}
                  </button>

                  {/* Enviar DOCX via WhatsApp */}
                  <button
                    onClick={handleSend}
                    disabled={sending || signingState === 'loading'}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black text-sm font-bold shadow-lg hover:shadow-amber-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                  >
                    {sending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>
                    ) : (
                      <><Send className="h-4 w-4" /> Enviar WhatsApp</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
