"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, HelpCircle, Loader2, Swords } from "lucide-react";
import api from "@/lib/api";

type Period = 7 | 30 | 90;

interface AuctionInsightRow {
  domain: string;
  impression_share: number | null;
  overlap_rate: number | null;
  position_above_rate: number | null;
  top_impression_rate: number | null;
  abs_top_impression_rate: number | null;
  outranking_share: number | null;
  samples: number;
}

interface AuctionInsightsData {
  days: number;
  self: {
    impression_share: number | null;
    top_impression_rate: number | null;
    abs_top_impression_rate: number | null;
  };
  rows: AuctionInsightRow[];
  unavailable_reason: string | null;
  last_error_at: string | null;
}

const PERIODS: Period[] = [7, 30, 90];

const COLUMN_HELP: Record<
  string,
  { title: string; description: string; ideal: string; howTo: string }
> = {
  impression_share: {
    title: "Parcela de impressões",
    description:
      "Percentual de impressões que o domínio recebeu nos leilões em que seus anúncios também eram elegíveis.",
    ideal:
      "Para você, quanto maior melhor. Para concorrentes, valores menores indicam menos presença competindo com você.",
    howTo:
      "Aumente orçamento nas campanhas rentáveis, melhore índice de qualidade, relevância dos anúncios e lances nas palavras que geram contrato.",
  },
  overlap_rate: {
    title: "Taxa de sobreposição",
    description:
      "Mostra com que frequência o concorrente apareceu no mesmo leilão em que você também apareceu.",
    ideal:
      "Quanto menor para concorrentes prioritários, melhor. Sobreposição alta indica disputa direta frequente.",
    howTo:
      "Revise termos muito genéricos, segmente melhor região/horário e fortaleça anúncios para consultas de maior intenção.",
  },
  position_above_rate: {
    title: "Posição superior",
    description:
      "Quando os dois anúncios apareceram, indica quantas vezes o concorrente ficou acima de você.",
    ideal:
      "Baixo é melhor. Se estiver alto, o concorrente está vencendo posição com frequência.",
    howTo:
      "Melhore Ad Rank: landing page mais rápida, anúncio mais aderente, extensões completas, CTR maior e lances seletivos.",
  },
  top_impression_rate: {
    title: "Parte superior",
    description:
      "Percentual de vezes em que o anúncio apareceu acima dos resultados orgânicos, no topo da página.",
    ideal:
      "Para você, alto em termos valiosos. Para concorrentes, alto indica domínio de visibilidade no topo.",
    howTo:
      "Concentre verba nos termos que convertem, ajuste lances por dispositivo/horário e remova buscas de baixa intenção.",
  },
  abs_top_impression_rate: {
    title: "1ª posição",
    description:
      "Percentual de vezes em que o anúncio foi exibido como o primeiro resultado pago absoluto.",
    ideal:
      "Use como métrica de intenção premium: busque alto apenas onde o CPL/ROAS justificam a disputa.",
    howTo:
      "Suba lances com cautela em campanhas lucrativas e compense com qualidade do anúncio e página para não comprar posição cara demais.",
  },
  outranking_share: {
    title: "Superação",
    description:
      "Percentual de leilões em que você apareceu acima do concorrente, ou apareceu quando ele não apareceu.",
    ideal:
      "Quanto maior, melhor. Indica vantagem competitiva direta contra aquele domínio.",
    howTo:
      "Proteja termos de alta conversão, ajuste orçamento para não perder impressão por verba e otimize qualidade para superar sem depender só de lance.",
  },
};

function fmtPct(value: number | null) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function shortError(message: string) {
  if (message.includes("not publicly available")) {
    return "A API do Google Ads reconhece esses campos, mas o developer token atual não tem acesso público a Auction Insights.";
  }
  return message.length > 240 ? `${message.slice(0, 240)}...` : message;
}

export function AuctionInsightsTab() {
  const [period, setPeriod] = useState<Period>(30);
  const [data, setData] = useState<AuctionInsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AuctionInsightsData>("/trafego/auction-insights", {
        params: { days: period },
      })
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (!cancelled) {
          setData({
            days: period,
            self: {
              impression_share: null,
              top_impression_rate: null,
              abs_top_impression_rate: null,
            },
            rows: [],
            unavailable_reason:
              err?.response?.data?.message ??
              "Erro ao carregar informações do leilão.",
            last_error_at: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Swords size={18} className="text-primary" />
            Informações do leilão
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Compara sua presença com domínios concorrentes que participaram dos
            mesmos leilões.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                if (period === p) return;
                setLoading(true);
                setPeriod(p);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                period === p
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p} dias
            </button>
          ))}
        </div>
      </div>

      {data?.unavailable_reason && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3">
              <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-foreground">
              Auction Insights ainda não disponível via API
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {shortError(data.unavailable_reason)}
            </p>
            {data.last_error_at && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Última tentativa:{" "}
                {new Date(data.last_error_at).toLocaleString("pt-BR")}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">
            Participantes do leilão
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Médias dos últimos {data?.days ?? period} dias. Valores abaixo de
            10% podem aparecer como 9,99% por limitação do Google Ads.
          </p>
        </div>

        {loading ? (
          <div className="h-52 flex items-center justify-center text-muted-foreground">
            <Loader2 size={20} className="animate-spin mr-2" />
            Carregando informações do leilão...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <TH>Domínio</TH>
                  <TH align="right" help={COLUMN_HELP.impression_share}>
                    Parcela de impressões
                  </TH>
                  <TH align="right" help={COLUMN_HELP.overlap_rate}>
                    Taxa de sobreposição
                  </TH>
                  <TH align="right" help={COLUMN_HELP.position_above_rate}>
                    Posição superior
                  </TH>
                  <TH align="right" help={COLUMN_HELP.top_impression_rate}>
                    Parte superior
                  </TH>
                  <TH align="right" help={COLUMN_HELP.abs_top_impression_rate}>
                    1ª posição
                  </TH>
                  <TH align="right" help={COLUMN_HELP.outranking_share}>
                    Superação
                  </TH>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border bg-primary/5">
                  <TD className="font-semibold text-foreground">Você</TD>
                  <TD align="right">
                    {fmtPct(data?.self.impression_share ?? null)}
                  </TD>
                  <TD align="right">-</TD>
                  <TD align="right">-</TD>
                  <TD align="right">
                    {fmtPct(data?.self.top_impression_rate ?? null)}
                  </TD>
                  <TD align="right">
                    {fmtPct(data?.self.abs_top_impression_rate ?? null)}
                  </TD>
                  <TD align="right">-</TD>
                </tr>

                {(data?.rows ?? []).map((row) => (
                  <tr
                    key={row.domain}
                    className="border-t border-border hover:bg-accent/30"
                  >
                    <TD className="font-medium text-foreground">
                      {row.domain}
                    </TD>
                    <TD align="right">{fmtPct(row.impression_share)}</TD>
                    <TD align="right">{fmtPct(row.overlap_rate)}</TD>
                    <TD align="right">{fmtPct(row.position_above_rate)}</TD>
                    <TD align="right">{fmtPct(row.top_impression_rate)}</TD>
                    <TD align="right">{fmtPct(row.abs_top_impression_rate)}</TD>
                    <TD align="right">{fmtPct(row.outranking_share)}</TD>
                  </tr>
                ))}

                {(!data?.rows || data.rows.length === 0) &&
                  !data?.unavailable_reason && (
                    <tr className="border-t border-border">
                      <td
                        colSpan={7}
                        className="px-5 py-10 text-center text-sm text-muted-foreground"
                      >
                        Nenhum concorrente com dados de leilão no período
                        selecionado.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TH({
  children,
  align = "left",
  help,
}: {
  children: ReactNode;
  align?: "left" | "right";
  help?: {
    title: string;
    description: string;
    ideal: string;
    howTo: string;
  };
}) {
  return (
    <th
      className={`px-5 py-3 font-bold ${align === "right" ? "text-right" : "text-left"}`}
    >
      <span
        className={`inline-flex items-center gap-1.5 ${align === "right" ? "justify-end" : "justify-start"}`}
      >
        {children}
        {help && <MetricHelp info={help} />}
      </span>
    </th>
  );
}

function MetricHelp({
  info,
}: {
  info: {
    title: string;
    description: string;
    ideal: string;
    howTo: string;
  };
}) {
  return (
    <span className="relative inline-flex group/help normal-case tracking-normal">
      <button
        type="button"
        aria-label={`Entender ${info.title}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <HelpCircle size={13} strokeWidth={2.2} />
      </button>
      <span className="pointer-events-none absolute right-0 top-6 z-50 hidden w-[min(340px,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-3 text-left shadow-xl group-hover/help:block group-focus-within/help:block">
        <span className="block text-[12px] font-bold text-foreground mb-1">
          {info.title}
        </span>
        <span className="block text-[11px] leading-relaxed text-muted-foreground">
          {info.description}
        </span>
        <span className="mt-2 block text-[10px] font-bold uppercase tracking-wider text-foreground/70">
          Valor ideal
        </span>
        <span className="block text-[11px] leading-relaxed text-muted-foreground">
          {info.ideal}
        </span>
        <span className="mt-2 block text-[10px] font-bold uppercase tracking-wider text-foreground/70">
          Como conquistar
        </span>
        <span className="block text-[11px] leading-relaxed text-muted-foreground">
          {info.howTo}
        </span>
      </span>
    </span>
  );
}

function TD({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`px-5 py-3 tabular-nums ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </td>
  );
}
