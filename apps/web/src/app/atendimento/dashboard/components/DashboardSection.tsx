'use client';

import type { ReactNode } from 'react';
import { MotionWidget } from './MotionWidget';
import type { SectionId } from '../sectionVisibility';

interface Props {
  id: SectionId;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  children: ReactNode;
  delay?: number;
}

/**
 * Wrapper de uma seção do dashboard. Renderiza cabeçalho com ícone/título,
 * separador visual e container para os widgets da seção. O `id` HTML permite
 * âncora (#geral, #advogados, etc.).
 */
export function DashboardSection({
  id,
  title,
  subtitle,
  icon,
  children,
  delay = 0,
}: Props) {
  return (
    <section id={id} className="scroll-mt-6">
      <MotionWidget delay={delay}>
        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border/60">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg md:text-xl font-bold text-foreground leading-tight">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[12px] text-muted-foreground leading-tight mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>
      </MotionWidget>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
