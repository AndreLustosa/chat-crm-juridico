'use client';

import { useEffect, useState } from 'react';
import { Loader2, Target, Inbox, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import api from '@/lib/api';
import { showError, showSuccess } from '@/lib/toast';

interface ConversionAction {
  id: string;
  google_conversion_id: string;
  name: string;
  category: string;
  status: string;
  type: string | null;
  crm_event_kind: string | null;
  default_value_brl: number | null;
}

interface OCIUpload {
  id: string;
  trigger_event: string;
  status: string;
  conversion_at: string;
  uploaded_at: string | null;
  error_message: string | null;
  gclid: string | null;
  manual: boolean;
  created_at: string;
}

const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '— Nao mapeado —' },
  { value: 'lead.created', label: 'Lead criado (entrada CRM)' },
  { value: 'lead.qualified', label: 'Lead qualificado' },
  { value: 'client.signed', label: 'Cliente assinou contrato' },
  { value: 'payment.received', label: 'Pagamento recebido' },
];

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  UPLOADED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  FAILED: 'bg-red-500/15 text-red-600 dark:text-red-400',
  DUPLICATE_REJECTED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

const STATUS_ICON: Record<string, any> = {
  PENDING: Clock,
  UPLOADED: CheckCircle2,
  FAILED: AlertCircle,
  DUPLICATE_REJECTED: AlertCircle,
};

const fmtBRL = (v: number | null) =>
  v === null
    ? '—'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(v);

export function ConversoesTab({ canManage }: { canManage: boolean }) {
  const [actions, setActions] = useState<ConversionAction[]>([]);
  const [uploads, setUploads] = useState<OCIUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [a, u] = await Promise.all([
        api.get<ConversionAction[]>('/trafego/conversion-actions'),
        // Como nao ha endpoint listOCIUploads ainda, usamos mutate-logs filtrado
        // pelo trigger oci-* (futuro): por ora, lista vazia.
        // TODO: criar endpoint /trafego/oci-uploads
        Promise.resolve({ data: [] as OCIUpload[] }),
      ]);
      setActions(a.data);
      setUploads(u.data);
    } catch {
      showError('Erro carregando conversoes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function updateMapping(
    ca: ConversionAction,
    crmEventKind: string,
    valueBrl: number | null,
  ) {
    if (!canManage) return;
    setSavingId(ca.id);
    try {
      await api.patch(`/trafego/conversion-actions/${ca.id}`, {
        crm_event_kind: crmEventKind === '' ? null : crmEventKind,
        default_value_brl: valueBrl,
      });
      showSuccess('Mapeamento atualizado.');
      await load();
    } catch (err: any) {
      showError(err?.response?.data?.message ?? 'Falha ao mapear conversao.');
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 size={28} className="animate-spin mb-2" />
        <p className="text-sm">Carregando conversoes...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Mapeamento de ConversionActions */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Target size={18} className="text-primary" />
            <h3 className="text-base font-bold text-foreground">
              ConversionActions do Google Ads
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Mapeie cada conversao do Google a um evento do CRM. Quando o evento
            disparar (lead criado, contrato assinado, pagamento recebido), o
            sistema sobe automaticamente uma conversao offline (OCI) com gclid
            do lead.
          </p>
        </div>

        {actions.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox size={40} className="mx-auto text-muted-foreground mb-3" />
            <h3 className="text-base font-bold text-foreground mb-1">
              Nenhuma ConversionAction sincronizada
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Crie ConversionActions no Google Ads (tipo "Lead" ou
              "Upload"), aguarde o proximo sync e elas aparecerao aqui.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Nome</th>
                <th className="text-left px-4 py-3">Categoria</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 w-64">Evento CRM</th>
                <th className="text-right px-4 py-3 w-32">Valor padrão</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr
                  key={a.id}
                  className="border-t border-border hover:bg-accent/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {a.category}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        a.status === 'ENABLED'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-zinc-500/15 text-zinc-500'
                      }`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="w-full px-2 py-1 text-xs bg-background border border-border rounded"
                      value={a.crm_event_kind ?? ''}
                      disabled={!canManage || savingId === a.id}
                      onChange={(e) =>
                        updateMapping(a, e.target.value, a.default_value_brl)
                      }
                    >
                      {EVENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={a.default_value_brl ?? ''}
                      placeholder="R$"
                      disabled={!canManage || savingId === a.id}
                      className="w-24 px-2 py-1 text-xs bg-background border border-border rounded text-right"
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value.replace(',', '.'));
                        const newVal =
                          Number.isFinite(v) && v >= 0 ? v : null;
                        if (newVal !== a.default_value_brl) {
                          updateMapping(
                            a,
                            a.crm_event_kind ?? '',
                            newVal,
                          );
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Audit de uploads OCI recentes */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-base font-bold text-foreground">
            Uploads recentes (audit)
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Conversoes offline subidas pro Google. Listagem aparece aqui apos o
            primeiro upload via evento CRM disparado por lead com gclid.
          </p>
        </div>

        {uploads.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum upload registrado ainda.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Evento</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Erro</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => {
                const Icon = STATUS_ICON[u.status] ?? Clock;
                return (
                  <tr
                    key={u.id}
                    className="border-t border-border hover:bg-accent/30"
                  >
                    <td className="px-4 py-3 text-xs">
                      {new Date(u.conversion_at).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {u.trigger_event}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          STATUS_BADGE[u.status] ?? 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <Icon size={11} />
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-md truncate">
                      {u.error_message ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
