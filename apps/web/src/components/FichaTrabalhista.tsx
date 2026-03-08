'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  User,
  MapPin,
  Briefcase,
  Clock,
  DollarSign,
  Shield,
  Wallet,
  FileCheck,
  FileText,
  Bot,
  Search,
} from 'lucide-react';
import { FICHA_SECTIONS, type FichaField, getEmptyFormData } from '@/lib/fichaTrabalhistaFields';
import api, { API_BASE_URL } from '@/lib/api';

// ─── Formatters ─────────────────────────────────────────────────

const formatMoney = (val: string): string => {
  if (!val) return '';
  // Remove R$, spaces, dots (thousands) and swap comma for dot
  const cleaned = val.replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return val; // texto livre como "salário mínimo" — mantém
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
};

const formatCPF = (val: string) => {
  if (!val) return '';
  let raw = val.replace(/\D/g, '');
  if (raw.length > 11) raw = raw.slice(0, 11);
  if (raw.length > 9) return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}`;
  if (raw.length > 6) return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6)}`;
  if (raw.length > 3) return `${raw.slice(0, 3)}.${raw.slice(3)}`;
  return raw;
};

const formatCEP = (val: string) => {
  if (!val) return '';
  let raw = val.replace(/\D/g, '');
  if (raw.length > 8) raw = raw.slice(0, 8);
  if (raw.length > 5) return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  return raw;
};

const formatPhone = (val: string) => {
  if (!val) return '';
  let raw = val.replace(/\D/g, '');
  if (raw.startsWith('55') && raw.length > 11) raw = raw.slice(2);
  if (raw.length > 11) raw = raw.slice(0, 11);
  if (raw.length > 10) return `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
  if (raw.length > 6) return `(${raw.slice(0, 2)}) ${raw.slice(2, 6)}-${raw.slice(6)}`;
  if (raw.length > 2) return `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
  return raw;
};

// ─── Icon resolver ──────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  User: <User size={18} />,
  MapPin: <MapPin size={18} />,
  Briefcase: <Briefcase size={18} />,
  Clock: <Clock size={18} />,
  DollarSign: <DollarSign size={18} />,
  Shield: <Shield size={18} />,
  Wallet: <Wallet size={18} />,
  FileCheck: <FileCheck size={18} />,
  FileText: <FileText size={18} />,
};

// ─── Props ──────────────────────────────────────────────────────

interface FichaTrabalhistaProps {
  leadId: string;
  readOnly?: boolean;
  isPublic?: boolean;
  onFinalize?: () => void;
}

export default function FichaTrabalhista({
  leadId,
  readOnly = false,
  isPublic = false,
  onFinalize,
}: FichaTrabalhistaProps) {
  const [formData, setFormData] = useState<Record<string, string>>(getEmptyFormData());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [finalizado, setFinalizado] = useState(false);
  const [completionPct, setCompletionPct] = useState(0);
  const [filledBy, setFilledBy] = useState('manual');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    pessoal: true,
  });
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const [loadingCep, setLoadingCep] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // ─── Fetch initial data ───────────────────────────────────────

  useEffect(() => {
    if (!leadId) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const endpoint = isPublic
          ? `/ficha-trabalhista/${leadId}/public`
          : `/ficha-trabalhista/${leadId}`;

        const res = await (isPublic
          ? fetch(`${API_BASE_URL}${endpoint}`)
          : api.get(endpoint));

        const fichaData = isPublic ? await (res as Response).json() : (res as any).data;

        if (fichaData?.data && typeof fichaData.data === 'object') {
          const merged = { ...getEmptyFormData(), ...fichaData.data };
          // Format fields
          if (merged.cpf) merged.cpf = formatCPF(merged.cpf);
          if (merged.cep) merged.cep = formatCEP(merged.cep);
          if (merged.telefone) merged.telefone = formatPhone(merged.telefone);
          // Format money fields
          for (const section of FICHA_SECTIONS) {
            for (const f of section.fields) {
              if (f.type === 'money' && merged[f.key]) {
                merged[f.key] = formatMoney(merged[f.key]);
              }
            }
          }
          setFormData(merged);

          // Auto-open sections that have filled data + track AI-filled fields
          const filledSections: Record<string, boolean> = { pessoal: true };
          const aiFields = new Set<string>();
          for (const section of FICHA_SECTIONS) {
            const hasFilled = section.fields.some((f) => {
              const v = (fichaData.data as Record<string, string>)[f.key];
              return v !== undefined && v !== null && v !== '';
            });
            if (hasFilled) {
              filledSections[section.id] = true;
              if (fichaData.filled_by === 'ai') {
                section.fields.forEach((f) => {
                  const v = (fichaData.data as Record<string, string>)[f.key];
                  if (v) aiFields.add(f.key);
                });
              }
            }
          }
          setOpenSections(filledSections);
          setAiFilledFields(aiFields);
        }
        setFinalizado(fichaData?.finalizado || false);
        setCompletionPct(fichaData?.completion_pct || 0);
        setFilledBy(fichaData?.filled_by || 'manual');
      } catch (err) {
        console.error('Erro carregando ficha:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [leadId, isPublic]);

  // ─── Handlers ─────────────────────────────────────────────────

  const handleChange = useCallback((field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleAutoSave = useCallback(
    async (field: string, value: string) => {
      if (readOnly || finalizado) return;
      // Don't auto-save CEP (handled by lookup)
      if (field === 'cep') return;

      setSaving(true);
      try {
        const endpoint = isPublic
          ? `/ficha-trabalhista/${leadId}/public`
          : `/ficha-trabalhista/${leadId}`;

        const body = { [field]: value };

        if (isPublic) {
          const res = await fetch(
            `${API_BASE_URL}${endpoint}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            },
          );
          const data = await res.json();
          setCompletionPct(data?.completion_pct || completionPct);
        } else {
          const res = await api.patch(endpoint, body);
          setCompletionPct(res.data?.completion_pct || completionPct);
        }
        setLastSaved(new Date());
      } catch (err) {
        console.error('Erro ao salvar:', err);
      } finally {
        setSaving(false);
      }
    },
    [leadId, isPublic, readOnly, finalizado, completionPct],
  );

  // ─── CEP Lookup ───────────────────────────────────────────────

  const handleCepLookup = useCallback(
    async (cep: string) => {
      const raw = cep.replace(/\D/g, '');
      if (raw.length !== 8) return;

      setLoadingCep(true);
      try {
        const res = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
        const data = await res.json();
        if (!data.erro) {
          const updates: Record<string, string> = {
            logradouro: data.logradouro || '',
            bairro: data.bairro || '',
            cidade: data.localidade || '',
            estado_uf: data.uf || '',
          };
          setFormData((prev) => ({ ...prev, ...updates, cep: formatCEP(raw) }));

          // Save all address fields + cep
          const endpoint = isPublic
            ? `/ficha-trabalhista/${leadId}/public`
            : `/ficha-trabalhista/${leadId}`;
          const body = { ...updates, cep: raw };

          if (isPublic) {
            await fetch(
              `${API_BASE_URL}${endpoint}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              },
            );
          } else {
            await api.patch(endpoint, body);
          }
          setLastSaved(new Date());
        }
      } catch (err) {
        console.error('Erro buscando CEP:', err);
      } finally {
        setLoadingCep(false);
      }
    },
    [leadId, isPublic],
  );

  // ─── Finalize ─────────────────────────────────────────────────

  const handleFinalize = useCallback(async () => {
    if (finalizado || finalizing) return;
    setFinalizing(true);
    try {
      const endpoint = isPublic
        ? `/ficha-trabalhista/${leadId}/public/finalize`
        : `/ficha-trabalhista/${leadId}/finalize`;

      if (isPublic) {
        await fetch(
          `${API_BASE_URL}${endpoint}`,
          { method: 'POST' },
        );
      } else {
        await api.post(endpoint);
      }
      setFinalizado(true);
      onFinalize?.();
    } catch (err) {
      console.error('Erro ao finalizar:', err);
    } finally {
      setFinalizing(false);
    }
  }, [leadId, isPublic, finalizado, finalizing, onFinalize]);

  // ─── Toggle sections ─────────────────────────────────────────

  const toggleSection = useCallback((sectionId: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  // ─── Render field ─────────────────────────────────────────────

  const renderField = (field: FichaField) => {
    const value = formData[field.key] || '';
    const isAiFilled = aiFilledFields.has(field.key) && value !== '';
    const disabled = readOnly || finalizado;

    const baseClasses =
      'w-full bg-background border border-border rounded-lg px-3 text-foreground focus:border-amber-500 outline-none transition-colors placeholder-muted-foreground text-sm';

    const onBlur = () => handleAutoSave(field.key, value);

    let input: React.ReactNode;

    switch (field.type) {
      case 'select':
        input = (
          <select
            value={value}
            onChange={(e) => {
              handleChange(field.key, e.target.value);
              handleAutoSave(field.key, e.target.value);
            }}
            disabled={disabled}
            className={`${baseClasses} h-12 sm:h-10 appearance-none bg-no-repeat bg-[length:16px] bg-[right_8px_center]`}
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
            }}
          >
            <option value="">Selecione...</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
        break;

      case 'textarea':
        input = (
          <textarea
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            rows={3}
            placeholder={field.placeholder}
            className={`${baseClasses} py-2 resize-none`}
          />
        );
        break;

      case 'cpf':
        input = (
          <input
            type="text"
            value={value}
            onChange={(e) => handleChange(field.key, formatCPF(e.target.value))}
            onBlur={onBlur}
            disabled={disabled}
            placeholder={field.placeholder}
            maxLength={14}
            className={`${baseClasses} h-12 sm:h-10`}
          />
        );
        break;

      case 'cep':
        input = (
          <div className="relative">
            <input
              type="text"
              value={value}
              onChange={(e) => handleChange(field.key, formatCEP(e.target.value))}
              onBlur={() => handleCepLookup(value)}
              disabled={disabled}
              placeholder={field.placeholder}
              maxLength={9}
              className={`${baseClasses} h-12 sm:h-10 pr-10`}
            />
            {loadingCep ? (
              <Loader2 size={14} className="absolute right-3 top-3 animate-spin text-amber-500" />
            ) : (
              <button
                type="button"
                onClick={() => handleCepLookup(value)}
                className="absolute right-2 top-2 p-1 rounded hover:bg-accent text-muted-foreground"
                title="Buscar CEP"
              >
                <Search size={14} />
              </button>
            )}
          </div>
        );
        break;

      case 'phone':
        input = (
          <input
            type="text"
            value={value}
            onChange={(e) => handleChange(field.key, formatPhone(e.target.value))}
            onBlur={onBlur}
            disabled={disabled}
            placeholder={field.placeholder}
            maxLength={15}
            className={`${baseClasses} h-12 sm:h-10`}
          />
        );
        break;

      case 'date':
        input = (
          <input
            type="date"
            value={value}
            onChange={(e) => {
              handleChange(field.key, e.target.value);
              handleAutoSave(field.key, e.target.value);
            }}
            disabled={disabled}
            className={`${baseClasses} h-12 sm:h-10`}
          />
        );
        break;

      case 'money':
        input = (
          <input
            type="text"
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
            onBlur={() => {
              const formatted = formatMoney(value);
              if (formatted !== value) handleChange(field.key, formatted);
              handleAutoSave(field.key, formatted || value);
            }}
            disabled={disabled}
            placeholder={field.placeholder}
            className={`${baseClasses} h-12 sm:h-10`}
          />
        );
        break;

      default:
        input = (
          <input
            type="text"
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            placeholder={field.placeholder}
            className={`${baseClasses} h-12 sm:h-10`}
          />
        );
    }

    return (
      <div
        key={field.key}
        className={field.colSpan === 2 ? 'col-span-1 sm:col-span-2' : ''}
      >
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          {field.label}
          {field.required && <span className="text-red-400">*</span>}
          {isAiFilled && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[9px] font-bold normal-case tracking-normal">
              <Bot size={8} /> SophIA
            </span>
          )}
        </label>
        {input}
      </div>
    );
  };

  // ─── Loading state ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-amber-500" />
        <span className="ml-2 text-[13px] text-muted-foreground">Carregando ficha...</span>
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-500"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <span className="text-xs font-mono text-muted-foreground shrink-0">
          {completionPct}%
        </span>
        {saving && (
          <span className="flex items-center gap-1 text-xs text-amber-500">
            <Loader2 size={12} className="animate-spin" /> Salvando...
          </span>
        )}
        {!saving && lastSaved && (
          <span className="flex items-center gap-1 text-xs text-emerald-500">
            <CheckCircle2 size={12} /> Salvo
          </span>
        )}
      </div>

      {/* Finalized banner */}
      {finalizado && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
          <CheckCircle2 size={16} className="text-emerald-500" />
          <span className="text-[13px] font-semibold text-emerald-500">
            Ficha finalizada com sucesso
          </span>
        </div>
      )}

      {/* Sections */}
      {FICHA_SECTIONS.map((section) => {
        const sectionFilled = section.fields.filter((f) => formData[f.key]).length;
        const sectionTotal = section.fields.length;
        const hasAiData = section.fields.some((f) => aiFilledFields.has(f.key));

        return (
        <div
          key={section.id}
          className="border border-border rounded-xl overflow-hidden"
        >
          <button
            onClick={() => toggleSection(section.id)}
            className="w-full px-4 py-4 sm:py-3 flex items-center justify-between hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 bg-amber-500/10 rounded-lg text-amber-500 shrink-0">
                {ICON_MAP[section.icon] || <FileText size={18} />}
              </div>
              <span className="text-sm font-bold text-foreground">
                {section.label}
              </span>
              {sectionFilled > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-semibold shrink-0">
                  {sectionFilled}/{sectionTotal}
                </span>
              )}
              {hasAiData && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold shrink-0">
                  <Bot size={9} /> SophIA
                </span>
              )}
            </div>
            {openSections[section.id] ? (
              <ChevronUp size={16} className="text-muted-foreground shrink-0 ml-2" />
            ) : (
              <ChevronDown size={16} className="text-muted-foreground shrink-0 ml-2" />
            )}
          </button>

          {openSections[section.id] && (
            <div className="px-4 pb-5 sm:pb-4 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-3">
              {section.fields.map((field) => renderField(field))}
            </div>
          )}
        </div>
        );
      })}

      {/* Finalize button */}
      {!readOnly && !finalizado && (
        <button
          onClick={handleFinalize}
          disabled={finalizing || completionPct < 10}
          className="w-full py-4 sm:py-3 rounded-xl font-bold text-base sm:text-[14px] transition-colors flex items-center justify-center gap-2
            bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {finalizing ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Finalizando...
            </>
          ) : (
            <>
              <CheckCircle2 size={16} /> Finalizar Ficha Trabalhista
            </>
          )}
        </button>
      )}
    </div>
  );
}
