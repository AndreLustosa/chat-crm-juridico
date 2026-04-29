'use client';

import { LucideIcon } from 'lucide-react';

interface PlaceholderTabProps {
  icon: LucideIcon;
  title: string;
  description: string;
  phase?: string;
}

export function PlaceholderTab({ icon: Icon, title, description, phase }: PlaceholderTabProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-12 text-center max-w-2xl mx-auto">
      <Icon size={42} className="mx-auto text-muted-foreground mb-4" />
      <h3 className="text-base font-bold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-3">{description}</p>
      {phase && (
        <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-primary/10 text-primary">
          {phase}
        </span>
      )}
    </div>
  );
}
