import type { SUPPORTED_DATE_PRESETS } from './constants.js';

export type DatePreset = (typeof SUPPORTED_DATE_PRESETS)[number];
export type CampaignStatusFilter = 'ENABLED' | 'PAUSED' | 'ALL';
export type MatchType = 'BROAD' | 'PHRASE' | 'EXACT';

export type DateRange = {
  from: string;
  to: string;
};

export type MetricTotals = {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
  cpc: number | null;
  cpl: number | null;
  conversion_rate: number;
};

export type ToolResponse<T> = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: { data: T };
  isError?: boolean;
};
