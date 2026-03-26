'use client';

import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

interface ShortcutGroup {
  label: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: 'Navegação',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Abrir busca global / paleta de comandos' },
      { keys: ['Alt', '↑'], description: 'Conversa anterior na lista' },
      { keys: ['Alt', '↓'], description: 'Próxima conversa na lista' },
      { keys: ['Esc'], description: 'Fechar modal / painel ativo' },
    ],
  },
  {
    label: 'Chat',
    shortcuts: [
      { keys: ['Alt', 'R'], description: 'Responder à última mensagem do cliente' },
      { keys: ['Ctrl', 'F'], description: 'Buscar dentro da conversa' },
      { keys: ['Ctrl', 'Shift', 'A'], description: 'Alternar modo IA (SophIA on/off)' },
      { keys: ['Enter'], description: 'Enviar mensagem' },
      { keys: ['Shift', 'Enter'], description: 'Nova linha na mensagem' },
    ],
  },
  {
    label: 'Mensagens',
    shortcuts: [
      { keys: ['/'], description: 'Abrir menu de respostas rápidas' },
      { keys: ['Esc'], description: 'Fechar menu de respostas rápidas / cancelar reply' },
    ],
  },
  {
    label: 'Geral',
    shortcuts: [
      { keys: ['?'], description: 'Mostrar esta ajuda de atalhos' },
    ],
  },
];

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Keyboard size={16} className="text-primary" />
            <h2 className="text-[14px] font-bold">Atalhos de teclado</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Shortcut groups */}
        <div className="overflow-y-auto max-h-[70vh] px-5 py-4 space-y-5">
          {SHORTCUT_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
                {group.label}
              </p>
              <div className="space-y-1.5">
                {group.shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-4">
                    <span className="text-[13px] text-muted-foreground">{s.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, j) => (
                        <span key={j}>
                          <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-muted border border-border text-[11px] font-mono font-semibold text-foreground shadow-sm">
                            {k}
                          </kbd>
                          {j < s.keys.length - 1 && (
                            <span className="text-muted-foreground/50 text-[10px] mx-0.5">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/20 text-[11px] text-muted-foreground text-center">
          Pressione <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">?</kbd> ou <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">Esc</kbd> para fechar
        </div>
      </div>
    </div>
  );
}
