/**
 * Tool definitions pro chat da IA do tráfego (Sprint H.3-H.4).
 *
 * Tools são descritas no formato OpenAI/Anthropic function calling. O LLM
 * decide qual chamar baseado na pergunta do user. Cada tool tem 3 partes:
 *   - schema (def JSON pra LLM)
 *   - handler (função TS que executa)
 *   - cap (read-only vs propose-action)
 *
 * IMPORTANTE: nenhuma tool faz mutate direto no Google Ads.
 * - Tools READ_ONLY consultam DB local (TrafficCampaign, TrafficMetricDaily, etc)
 * - Tool propose_action cria TrafficChatMessage com proposed_action='PENDING_APPROVAL'.
 *   Admin clica "Aplicar" na UI → executa via GoogleAdsMutateService normal.
 */
import type { LLMToolDef } from '../ai/llm-client';

export const CHAT_TOOL_DEFS: LLMToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'list_campaigns',
      description:
        'Lista campanhas Google Ads ativas com nome, status, channel_type, daily_budget e service_category. Use pra responder "quais campanhas eu tenho?", "campanhas de trabalhista?", etc.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['ENABLED', 'PAUSED', 'ALL'],
            description: 'Filtrar por status. Default ENABLED.',
          },
          service_category: {
            type: 'string',
            description:
              'Filtra por categoria do escritório (ex: "trabalhista", "civil", "familia").',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_kpis',
      description:
        'Retorna KPIs agregados do tráfego (gasto total, leads, CPL médio, CTR, ROAS) num período. Use pra "como está o tráfego este mês?", "quanto gastei em maio?".',
      parameters: {
        type: 'object',
        properties: {
          date_from: {
            type: 'string',
            description: 'Data inicial ISO (YYYY-MM-DD). Default 30 dias atrás.',
          },
          date_to: {
            type: 'string',
            description: 'Data final ISO (YYYY-MM-DD). Default hoje.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_campaign_metrics',
      description:
        'Métricas detalhadas de UMA campanha por período. Retorna série diária + agregados. Use pra "como performou X?", "evolução do CPL da campanha Y".',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: {
            type: 'string',
            description: 'ID local (UUID) da campanha. Use list_campaigns pra descobrir.',
          },
          date_from: { type: 'string', description: 'YYYY-MM-DD. Default 30d atrás.' },
          date_to: { type: 'string', description: 'YYYY-MM-DD. Default hoje.' },
        },
        required: ['campaign_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_periods',
      description:
        'Compara KPIs entre dois períodos (ex: este mês vs mês passado, abril 2025 vs abril 2024). Retorna delta absoluto e percentual.',
      parameters: {
        type: 'object',
        properties: {
          period_a_from: { type: 'string', description: 'YYYY-MM-DD' },
          period_a_to: { type: 'string', description: 'YYYY-MM-DD' },
          period_b_from: { type: 'string', description: 'YYYY-MM-DD' },
          period_b_to: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['period_a_from', 'period_a_to', 'period_b_from', 'period_b_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_keywords',
      description:
        'Lista keywords de uma campanha ou ad_group com performance. Use pra "quais keywords trabalhista?", "keywords com CPL alto".',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'ID local da campanha (opcional)' },
          ad_group_id: { type: 'string', description: 'ID local do ad_group (opcional)' },
          limit: { type: 'integer', description: 'Default 50, max 200.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_ads',
      description:
        'Lista ads de um ad_group com headlines, status, approval_status. Útil pra "quais ads em X?", "ads desaprovados?".',
      parameters: {
        type: 'object',
        properties: {
          ad_group_id: { type: 'string' },
          campaign_id: { type: 'string' },
          approval_status: {
            type: 'string',
            enum: ['APPROVED', 'DISAPPROVED', 'UNDER_REVIEW', 'ELIGIBLE', 'ALL'],
          },
          limit: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_search_terms',
      description:
        'Lista termos de busca sincronizados com metricas de gasto, cliques, impressoes e conversoes. Use pra achar termos ruins, termos caros sem conversao e oportunidades de negativa.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'ID local da campanha (opcional)' },
          ad_group_id: { type: 'string', description: 'ID local do ad_group (opcional)' },
          min_spend_brl: { type: 'number', description: 'Gasto minimo em R$ para filtrar.' },
          only_zero_conversions: { type: 'boolean', description: 'Se true, traz apenas termos com zero conversoes.' },
          limit: { type: 'integer', description: 'Default 30, max 100.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_auction_insights',
      description:
        'Consulta informacoes do leilao por dominio concorrente: parcela de impressoes, taxa de sobreposicao, posicao superior, parte superior, primeira posicao e superacao.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'ID local da campanha (opcional)' },
          date_from: { type: 'string', description: 'YYYY-MM-DD. Default 30d atras.' },
          date_to: { type: 'string', description: 'YYYY-MM-DD. Default hoje.' },
          limit: { type: 'integer', description: 'Default 20, max 100.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_landing_pages',
      description:
        'Lista landing pages vinculadas ao trafego com PageSpeed, Core Web Vitals, clicks/conversoes 30d e analise IA salva.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'ID local da campanha (opcional)' },
          limit: { type: 'integer', description: 'Default 30, max 100.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_conversion_actions',
      description:
        'Lista conversion actions do Google Ads com status, categoria, include_in_conversions, evento CRM mapeado e valor padrao.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ENABLED', 'REMOVED', 'HIDDEN', 'ALL'] },
          only_mapped: { type: 'boolean', description: 'Se true, traz apenas conversoes ligadas a evento CRM.' },
          limit: { type: 'integer', description: 'Default 50, max 100.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_lead_form_submissions',
      description:
        'Lista submissions recebidas por Lead Form Asset, com status, lead criado, campanha, telefone/e-mail e data de envio.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'ERROR', 'ALL'] },
          limit: { type: 'integer', description: 'Default 20, max 100.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_asset_groups',
      description:
        'Lista asset groups de PMax/Demand Gen/branding, com status, ad_strength e assets principais quando disponiveis.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'ID local da campanha (opcional)' },
          status: { type: 'string', enum: ['ENABLED', 'PAUSED', 'REMOVED', 'ALL'] },
          limit: { type: 'integer', description: 'Default 30, max 100.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_metric_breakdowns',
      description:
        'Consulta quebras por dispositivo, horario e agenda de anuncios em um periodo. Use para perguntas como "qual melhor horario?" ou "mobile converte melhor?".',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'ID local da campanha (opcional)' },
          date_from: { type: 'string', description: 'YYYY-MM-DD. Default 30d atras.' },
          date_to: { type: 'string', description: 'YYYY-MM-DD. Default hoje.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_alerts',
      description:
        'Alertas operacionais abertos (HIGH_CPL, OVERSPEND, ZERO_CONVERSIONS, etc). Use pra "tem algum problema?", "alertas de hoje?".',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL', 'ALL'] },
          limit: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_decisions',
      description:
        'Decisões da IA Otimizadora (executadas, sugestões, bloqueadas por OAB). Use pra "o que a IA fez essa semana?", "sugestões pendentes?".',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['EXECUTE', 'SUGGEST', 'BLOCK', 'NOTIFY_ONLY', 'FAILED', 'ALL'],
          },
          days: { type: 'integer', description: 'Janela em dias. Default 7.' },
          limit: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recommendations',
      description:
        'Recomendações vivas da Google Ads API (com filtro OAB já aplicado). Use pra "quais recomendações abertas?", "tem sugestão da Google bloqueada por OAB?".',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['READY', 'OAB_BLOCKED', 'PENDING', 'ALL'],
          },
          type: { type: 'string', description: 'Tipo: KEYWORD, CAMPAIGN_BUDGET, etc.' },
          limit: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_action',
      description:
        'PROPÕE uma ação de mutate no Google Ads (pausar campanha, ajustar budget, adicionar negative keyword). NÃO executa direto — vira card "Aplicar/Rejeitar" pro admin confirmar. Use só quando o user pediu explicitamente uma ação ou aprovou uma sugestão sua.',
      parameters: {
        type: 'object',
        properties: {
          action_kind: {
            type: 'string',
            enum: [
              'PAUSE_CAMPAIGN',
              'RESUME_CAMPAIGN',
              'PAUSE_AD_GROUP',
              'RESUME_AD_GROUP',
              'PAUSE_AD',
              'UPDATE_BUDGET',
              'ADD_NEGATIVE_KEYWORD_CAMPAIGN',
              'ADD_NEGATIVE_KEYWORD_AD_GROUP',
            ],
          },
          campaign_id: { type: 'string', description: 'ID local da campanha (UUID)' },
          ad_group_id: { type: 'string' },
          ad_id: { type: 'string' },
          new_amount_brl: {
            type: 'number',
            description: 'Pra UPDATE_BUDGET: novo valor diário em R$.',
          },
          negative_keyword: {
            type: 'string',
            description: 'Pra ADD_NEGATIVE_KEYWORD_*: termo a adicionar.',
          },
          match_type: {
            type: 'string',
            enum: ['EXACT', 'PHRASE', 'BROAD'],
            description: 'Pra negative keyword. Default PHRASE.',
          },
          reason: {
            type: 'string',
            description:
              'Justificativa em pt-BR pra exibir pro admin no card de aprovação.',
          },
        },
        required: ['action_kind', 'reason'],
      },
    },
  },
];

// Tipos auxiliares
export type ProposedAction = {
  action_kind: string;
  campaign_id?: string;
  ad_group_id?: string;
  ad_id?: string;
  new_amount_brl?: number;
  negative_keyword?: string;
  match_type?: 'EXACT' | 'PHRASE' | 'BROAD';
  reason: string;
};
