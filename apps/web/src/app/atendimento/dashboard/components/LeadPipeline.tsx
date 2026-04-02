'use client';

import { Briefcase } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { PipelineBar } from './PipelineBar';
import { CRM_STAGES } from '@/lib/crmStages';
import type { DashboardData } from '../types';

interface Props {
  pipeline: DashboardData['leadPipeline'];
}

export function LeadPipeline({ pipeline }: Props) {
  if (pipeline.length === 0) return null;

  const max = Math.max(...pipeline.map((s) => s.count), 1);

  return (
    <WidgetCard
      title="Pipeline de Leads"
      icon={<Briefcase size={15} className="text-primary" />}
      linkLabel="Ver CRM"
      linkHref="/atendimento/crm"
    >
      <div className="space-y-2">
        {CRM_STAGES.map((stage) => {
          const count = pipeline.find((s) => s.stage === stage.id)?.count || 0;
          return (
            <PipelineBar
              key={stage.id}
              label={stage.label}
              count={count}
              max={max}
              color={stage.color}
              emoji={stage.emoji}
            />
          );
        })}
      </div>
    </WidgetCard>
  );
}
