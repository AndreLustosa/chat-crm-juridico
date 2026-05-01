'use client';

import { useState } from 'react';
import { Loader2, AlertTriangle, AlertCircle, Info } from 'lucide-react';

type Variant = 'danger' | 'warning' | 'default';

const VARIANT_STYLE: Record<
  Variant,
  { icon: any; iconColor: string; btnColor: string }
> = {
  danger: {
    icon: AlertCircle,
    iconColor: 'text-red-500',
    btnColor: 'bg-red-600 hover:bg-red-700',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    btnColor: 'bg-amber-600 hover:bg-amber-700',
  },
  default: {
    icon: Info,
    iconColor: 'text-violet-500',
    btnColor: 'bg-violet-600 hover:bg-violet-700',
  },
};

/**
 * Modal genérico de confirmação. Substitui `confirm()` nativo do browser
 * que tem UX feia. Suporta 3 variantes (danger/warning/default) e ação
 * async — bloqueia botões e mostra spinner enquanto onConfirm retorna.
 */
export function ConfirmActionModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const sty = VARIANT_STYLE[variant];
  const Icon = sty.icon;

  if (!open) return null;

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="bg-card border border-border rounded-xl w-full max-w-md p-5">
        <div className="flex items-start gap-3 mb-4">
          <Icon size={22} className={`shrink-0 mt-0.5 ${sty.iconColor}`} />
          <div className="flex-1">
            <h3 className="text-base font-bold text-foreground">{title}</h3>
            <div className="text-sm text-muted-foreground mt-1">
              {message}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-md text-white font-semibold disabled:opacity-50 ${sty.btnColor}`}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
