'use client';

import { Bot } from 'lucide-react';

export default function AiSettingsPage() {
  return (
    <div className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
      <header className="px-8 mb-6 shrink-0">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Ajustes IA</h1>
        <p className="text-[13px] text-muted-foreground mt-1">Configure o comportamento da inteligência artificial no atendimento.</p>
      </header>
      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col">
        <div className="bg-card rounded-2xl border border-border flex-1 flex flex-col items-center justify-center p-12 text-center shadow-sm">
          <div className="w-20 h-20 rounded-2xl bg-primary/5 flex items-center justify-center mb-6 border border-primary/10">
            <Bot className="w-10 h-10 text-primary opacity-60" />
          </div>
          <h3 className="text-lg font-bold text-foreground tracking-tight mb-2">Em breve</h3>
          <p className="text-[13px] text-muted-foreground max-w-[280px]">Configurações de prompts, skills e políticas da IA para o seu escritório.</p>
        </div>
      </div>
    </div>
  );
}
