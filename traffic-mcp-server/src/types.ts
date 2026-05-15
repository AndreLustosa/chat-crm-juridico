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

export type ToolErrorKind =
  | 'unknown'
  | 'auth'
  | 'not_found'
  | 'validation'
  | 'rate_limit'
  | 'guard_rail'
  | 'upstream'
  | 'network'
  | 'google_ads_quota'
  | 'google_ads_permission';

export type ToolStructuredContent<T> = {
  data: T;
  error?: {
    kind: ToolErrorKind;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type ToolResponse<T> = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: ToolStructuredContent<T>;
  isError?: boolean;
};
