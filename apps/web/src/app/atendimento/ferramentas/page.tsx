'use client';

import { useRouter } from 'next/navigation';
import { AudioLines, Wrench, ChevronRight } from 'lucide-react';

interface ToolCard {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  accent: string; // tailwind text color
  available: boolean;
}

// Hub extensível — cada nova ferramenta vira um card aqui.
const TOOLS: ToolCard[] = [
  {
    id: 'transcricoes',
    title: 'Transcrição de Audiência',
    description:
      'Upload de vídeo (ASF/MP4/MKV) → conversão → transcrição com separação de falantes. ' +
      'Vincule ao processo pra IA usar no briefing, ou use avulsa.',
    icon: AudioLines,
    href: '/atendimento/ferramentas/transcricoes',
    accent: 'text-violet-400',
    available: true,
  },
  // Placeholder: novas ferramentas entram aqui. Ex:
  // { id: 'peticionar', title: 'Peticionar em Lote', ... }
];

export default function FerramentasPage() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-base-content flex items-center gap-2">
          <Wrench className="h-6 w-6 text-primary" /> Ferramentas
        </h1>
        <p className="text-sm text-base-content/60 mt-1">
          Utilitários que aceleram o dia a dia. Alguns se integram ao processo, outros funcionam avulsos.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              disabled={!tool.available}
              onClick={() => tool.available && router.push(tool.href)}
              className="group text-left p-5 rounded-xl border border-border bg-accent/5 hover:bg-accent/20 hover:border-primary/40 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`h-12 w-12 rounded-lg bg-accent/30 flex items-center justify-center ${tool.accent}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <ChevronRight className="h-5 w-5 text-base-content/30 group-hover:text-primary transition" />
              </div>
              <h3 className="font-semibold text-base-content mb-1">{tool.title}</h3>
              <p className="text-sm text-base-content/60 leading-relaxed">{tool.description}</p>
              {!tool.available && (
                <p className="text-xs text-base-content/40 mt-2">Em breve</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
