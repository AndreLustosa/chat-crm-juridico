'use client';

import { Building2 } from 'lucide-react';

export default function OfficeSettingsPage() {
  return (
    <div className="flex-1 flex flex-col pt-8 overflow-hidden bg-background">
      <header className="px-8 mb-6 shrink-0">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Escritório</h1>
        <p className="text-[13px] text-muted-foreground mt-1">Dados do escritório, áreas de atuação e informações gerais.</p>
      </header>
      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col">
        <div className="bg-card rounded-2xl border border-border flex-1 flex flex-col items-center justify-center p-12 text-center shadow-sm">
          <div className="w-20 h-20 rounded-2xl bg-primary/5 flex items-center justify-center mb-6 border border-primary/10">
            <Building2 className="w-10 h-10 text-primary opacity-60" />
          </div>
          <h3 className="text-lg font-bold text-foreground tracking-tight mb-2">Em breve</h3>
          <p className="text-[13px] text-muted-foreground max-w-[280px]">Configurações dos dados técnicos, endereço e identidade do escritório.</p>
        </div>
      </div>
    </div>
  );
}
