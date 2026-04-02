'use client';

import { Scale, BookOpen } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { PipelineBar } from './PipelineBar';
import { getStageCount } from '../utils';
import { LEGAL_STAGES, TRACKING_STAGES } from '@/lib/legalStages';
import type { DashboardData } from '../types';

interface Props {
  legalCases: DashboardData['legalCases'];
  trackingCases: DashboardData['trackingCases'];
}

export function LegalCasesPipeline({ legalCases, trackingCases }: Props) {
  if (legalCases.total === 0 && trackingCases.total === 0) return null;

  const legalMax = Math.max(...legalCases.byStage.map((s) => s.count), 1);
  const trackingMax = Math.max(...trackingCases.byStage.map((s) => s.count), 1);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <WidgetCard
        title="Preparacao"
        icon={<Scale size={15} className="text-primary" />}
        badge={`${legalCases.total} caso(s)`}
      >
        <div className="space-y-2">
          {LEGAL_STAGES.map((stage) => (
            <PipelineBar
              key={stage.id}
              label={stage.label}
              count={getStageCount(legalCases.byStage, stage.id)}
              max={legalMax}
              color={stage.color}
              emoji={stage.emoji}
            />
          ))}
        </div>
      </WidgetCard>

      <WidgetCard
        title="Acompanhamento"
        icon={<BookOpen size={15} className="text-primary" />}
        badge={`${trackingCases.total} processo(s)`}
      >
        <div className="space-y-2">
          {TRACKING_STAGES.map((stage) => (
            <PipelineBar
              key={stage.id}
              label={stage.label}
              count={getStageCount(trackingCases.byStage, stage.id)}
              max={trackingMax}
              color={stage.color}
              emoji={stage.emoji}
            />
          ))}
        </div>
      </WidgetCard>
    </div>
  );
}
