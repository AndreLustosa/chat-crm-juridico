'use client';

import { useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Clipboard,
  Database,
  Eye,
  MessageSquare,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';

type CapabilityStatus = 'available' | 'partial' | 'blocked';

type Capability = {
  title: string;
  description: string;
  status: CapabilityStatus;
};

const STATUS_STYLE: Record<
  CapabilityStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  available: {
    label: 'Disponivel',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
    icon: CheckCircle2,
  },
  partial: {
    label: 'Parcial',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
    icon: Eye,
  },
  blocked: {
    label: 'Nao acessa',
    className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-600',
    icon: XCircle,
  },
};

const READ_CAPABILITIES: Capability[] = [
  {
    title: 'Dashboard e KPIs',
    description:
      'Gasto, cliques, impressoes, conversoes, CTR, CPC medio, CPL e comparacao entre periodos.',
    status: 'available',
  },
  {
    title: 'Campanhas, grupos, anuncios e keywords',
    description:
      'Lista campanhas, status, orcamento, anuncios, aprovacao, headlines, keywords, qualidade e lances.',
    status: 'available',
  },
  {
    title: 'Leilao e concorrentes',
    description:
      'Consulta dominios concorrentes, parcela de impressoes, sobreposicao, posicao superior, topo e superacao quando o sync gravou esses dados.',
    status: 'available',
  },
  {
    title: 'Termos de busca',
    description:
      'Consulta termos pesquisados, gasto, cliques, conversoes e status para apoiar negativas.',
    status: 'available',
  },
  {
    title: 'Conversoes e leads',
    description:
      'Enxerga conversion actions, mapeamento CRM, valor padrao e submissions de Lead Form gravadas no sistema.',
    status: 'available',
  },
  {
    title: 'Landing pages e PageSpeed',
    description:
      'Consulta URLs, scores mobile/desktop, Core Web Vitals, conversoes e ultima analise IA.',
    status: 'available',
  },
  {
    title: 'PMax/Branding',
    description:
      'Consulta asset groups, assets principais e forecasts de reach quando existirem no cache local.',
    status: 'partial',
  },
  {
    title: 'Dispositivo, horario e agenda',
    description:
      'Consulta breakdowns por device, horario e agenda de anuncios quando o sync ja populou essas tabelas.',
    status: 'available',
  },
  {
    title: 'Dados ao vivo direto do Google',
    description:
      'A conversa usa o banco/cache local sincronizado. Para dados novos, rode Sincronizar agora antes de perguntar.',
    status: 'partial',
  },
];

const ACTION_CAPABILITIES: Capability[] = [
  {
    title: 'Propor pausas e retomadas',
    description:
      'Pode propor pausar/retomar campanha ou grupo e pausar anuncio. A acao vira card para aprovacao.',
    status: 'available',
  },
  {
    title: 'Alterar orcamento',
    description:
      'Pode propor novo orcamento diario. Mudancas passam por confirmacao humana.',
    status: 'available',
  },
  {
    title: 'Adicionar palavra negativa',
    description:
      'Pode propor negativa em campanha ou grupo, usando termo e tipo de correspondencia.',
    status: 'available',
  },
  {
    title: 'Excluir campanha ou criar campanhas',
    description:
      'A IA ainda nao executa exclusao, criacao, RSA, landing pages, conversoes ou assets via chat.',
    status: 'blocked',
  },
];

export const TRAFFIC_AI_PROMPT = `Voce e a assistente de IA da gestao de trafego do escritorio Andre Lustosa Advogados (Maceio/AL). Foco em advocacia Trabalhista, Civil, Familia, Empresarial.

CAPACIDADES
- Voce tem ferramentas para consultar dados reais do CRM/cache Google Ads: campanhas, metricas, leilao/concorrentes, termos de busca, keywords, ads, landing pages, lead forms, conversion actions, asset groups, device/hora/agenda, alertas, decisoes da IA e recomendacoes Google.
- Voce pode propor acoes via ferramenta propose_action. Nao executa direto. A proposta vira card Aplicar/Rejeitar para o admin confirmar.
- Sempre que precisar de dados, use uma ferramenta. Nao invente numeros.

TOM E ESTILO
- Portugues brasileiro, profissional e direto.
- Responda sem enrolacao.
- Use listas quando ajudar.
- Formate valores em reais e percentuais no padrao brasileiro.

REGRAS OAB
- Nunca prometa resultado.
- Nunca recomende termos como melhor advogado, advogado top ou advogado garantido.
- Evite termos com garantia, promessa ou milagre.
- Pode trabalhar termos descritivos do servico, como indenizacao trabalhista ou rescisao indireta.

QUANDO PROPOR ACAO
- So proponha acao concreta quando o usuario pediu explicitamente ou quando os dados consultados indicarem problema claro e o usuario perguntar o que fazer.
- Sempre inclua uma justificativa detalhada em portugues.
- Para mudancas de budget, use etapas conservadoras.

LIMITES
- Perguntas fora de trafego/Google Ads devem ser redirecionadas para os outros agentes do CRM.
- A conversa usa dados sincronizados no banco local. Se o Google Ads mudou agora, sincronize antes.`;

const TOOLS = [
  'list_campaigns',
  'get_dashboard_kpis',
  'get_campaign_metrics',
  'compare_periods',
  'list_keywords',
  'list_ads',
  'list_search_terms',
  'list_auction_insights',
  'list_landing_pages',
  'list_conversion_actions',
  'list_lead_form_submissions',
  'list_asset_groups',
  'get_metric_breakdowns',
  'list_recent_alerts',
  'list_recent_decisions',
  'list_recommendations',
  'propose_action',
];

export function AiKnowledgePanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<'access' | 'prompt'>('access');

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-accent/40"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-violet-500/10 text-violet-700 flex items-center justify-center shrink-0">
            <Bot size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground">
              Prompt, skill e acessos da IA
            </h3>
            <p className="text-xs text-muted-foreground">
              Veja exatamente o que a IA consegue consultar, propor e quais limites ela respeita.
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold text-violet-700">
          {open ? 'Ocultar' : 'Ver detalhes'}
        </span>
      </button>

      {open && (
        <div className="border-t border-border p-4">
          <div className="flex flex-wrap gap-2 mb-4">
            <PanelButton
              active={view === 'access'}
              icon={Database}
              label="Acessos"
              onClick={() => setView('access')}
            />
            <PanelButton
              active={view === 'prompt'}
              icon={Clipboard}
              label="Prompt/skill"
              onClick={() => setView('prompt')}
            />
          </div>

          {view === 'access' ? (
            <AccessView />
          ) : (
            <PromptView />
          )}
        </div>
      )}
    </section>
  );
}

function PanelButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Database;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg border ${
        active
          ? 'border-violet-500/40 bg-violet-500/10 text-violet-700'
          : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function AccessView() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <CapabilityGroup
        icon={Database}
        title="Dados que ela consulta"
        items={READ_CAPABILITIES}
      />
      <CapabilityGroup
        icon={Wrench}
        title="Acoes que ela pode propor"
        items={ACTION_CAPABILITIES}
      />
      <div className="xl:col-span-2 rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2 text-xs font-bold text-foreground mb-2">
          <ShieldCheck size={14} />
          Ferramentas disponiveis no chat
        </div>
        <div className="flex flex-wrap gap-2">
          {TOOLS.map((tool) => (
            <code
              key={tool}
              className="text-[11px] px-2 py-1 rounded-md border border-border bg-card text-muted-foreground"
            >
              {tool}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}

function CapabilityGroup({
  icon: Icon,
  title,
  items,
}: {
  icon: typeof Database;
  title: string;
  items: Capability[];
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs font-bold text-foreground mb-3">
        <Icon size={14} />
        {title}
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const status = STATUS_STYLE[item.status];
          const StatusIcon = status.icon;
          return (
            <div
              key={item.title}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {item.title}
                </p>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${status.className}`}
                >
                  <StatusIcon size={11} />
                  {status.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {item.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PromptView() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed text-foreground">
        {TRAFFIC_AI_PROMPT}
      </pre>
      <div className="rounded-lg border border-border bg-muted/20 p-3 h-fit">
        <div className="flex items-center gap-2 text-xs font-bold text-foreground mb-3">
          <MessageSquare size={14} />
          Como usar
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>Pergunte com periodo e objetivo: &quot;compare abril com marco&quot; ou &quot;qual campanha esta com CPL pior?&quot;.</p>
          <p>Para acao real, peca explicitamente: &quot;proponha pausar a campanha X&quot;. A IA cria um card para voce aprovar.</p>
          <p>Para numeros mais atuais, sincronize antes. A IA conversa com o cache local, nao com a tela aberta do Google Ads.</p>
        </div>
      </div>
    </div>
  );
}
