'use client';

import { useRouter } from 'next/navigation';
import { Bell, Gavel, ChevronRight } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import type { DjenItem } from '../types';

interface Props {
  items: DjenItem[];
}

export function DjenPublications({ items }: Props) {
  const router = useRouter();

  if (items.length === 0) return null;

  return (
    <WidgetCard
      title="Publicacoes DJEN"
      icon={<Bell size={15} className="text-violet-500" />}
      badge="Ultimos 7 dias"
    >
      <div className="space-y-2">
        {items.slice(0, 5).map((pub) => (
          <div
            key={pub.id}
            onClick={() => pub.legal_case_id && router.push(`/atendimento/workspace/${pub.legal_case_id}`)}
            className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${pub.legal_case_id ? 'hover:bg-muted/50 cursor-pointer' : ''}`}
          >
            <Gavel size={14} className="text-violet-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">
                {pub.tipo_comunicacao || 'Publicacao'} — {pub.numero_processo}
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{new Date(pub.data_disponibilizacao).toLocaleDateString('pt-BR')}</span>
                {pub.lead_name && <span>· {pub.lead_name}</span>}
              </div>
            </div>
            {pub.legal_case_id && <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}
