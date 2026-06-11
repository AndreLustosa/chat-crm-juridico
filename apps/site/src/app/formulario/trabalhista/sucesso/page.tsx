'use client';

import { CheckCircle2 } from 'lucide-react';

export default function FormularioSucessoPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-md mx-auto px-6 text-center">
        {/* Logo */}
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle2 size={32} className="text-emerald-500" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3">
          Ficha recebida com sucesso!
        </h1>

        <p className="text-[14px] text-muted-foreground leading-relaxed mb-6">
          Obrigado por preencher a ficha trabalhista. Nosso advogado irá analisar
          as informações fornecidas e entrará em contato em breve pelo WhatsApp.
        </p>

        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-[12px] font-semibold text-foreground mb-2">
            Próximos passos:
          </p>
          <ul className="text-[13px] text-muted-foreground text-left space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5 shrink-0">1.</span>
              <span>O advogado vai revisar todas as informações do seu caso</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5 shrink-0">2.</span>
              <span>
                Você receberá uma mensagem no WhatsApp com a análise preliminar
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5 shrink-0">3.</span>
              <span>
                Caso necessário, será agendada uma reunião para detalhamento
              </span>
            </li>
          </ul>
        </div>

        <p className="mt-8 text-[11px] text-muted-foreground">
          André Lustosa Advogados
        </p>
      </div>
    </div>
  );
}
