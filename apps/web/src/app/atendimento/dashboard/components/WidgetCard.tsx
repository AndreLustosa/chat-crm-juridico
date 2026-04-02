'use client';

import { ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  icon?: ReactNode;
  linkLabel?: string;
  linkHref?: string;
  badge?: string;
  loading?: boolean;
  children: ReactNode;
}

export function WidgetCard({ title, icon, linkLabel, linkHref, badge, loading, children }: Props) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-4 h-4 bg-muted rounded" />
          <div className="h-4 w-32 bg-muted rounded" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full bg-muted rounded" />
          <div className="h-3 w-3/4 bg-muted rounded" />
          <div className="h-3 w-1/2 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          {icon}
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="text-[10px] text-muted-foreground font-bold">{badge}</span>
          )}
          {linkLabel && linkHref && (
            <button
              onClick={() => router.push(linkHref)}
              className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
            >
              {linkLabel} <ChevronRight size={11} />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
