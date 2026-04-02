import { Calendar, Clock, FileText, Gavel } from 'lucide-react';
import { createElement } from 'react';
import type { DashboardData, TeamMember } from './types';

/* ─── Greeting ─── */

export function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function formatDateFull(): string {
  return new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function firstName(name: string): string {
  return name.split(' ')[0];
}

/* ─── Formatting ─── */

export const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export const fmtCompact = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
  }).format(v);

export function formatEventDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Hoje, ${time}`;
  if (isTomorrow) return `Amanha, ${time}`;
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + `, ${time}`;
}

/* ─── Event helpers ─── */

export function getEventColor(type: string): string {
  switch (type?.toUpperCase()) {
    case 'CONSULTA': return 'bg-blue-500';
    case 'AUDIENCIA': return 'bg-rose-500';
    case 'PRAZO': return 'bg-amber-500';
    case 'TAREFA': return 'bg-green-500';
    default: return 'bg-gray-400';
  }
}

export function getEventIcon(type: string) {
  switch (type?.toUpperCase()) {
    case 'AUDIENCIA': return createElement(Gavel, { size: 13 });
    case 'PRAZO': return createElement(Clock, { size: 13 });
    case 'TAREFA': return createElement(FileText, { size: 13 });
    default: return createElement(Calendar, { size: 13 });
  }
}

/* ─── Stage helpers ─── */

export function getStageCount(stages: { stage: string; count: number }[], id: string): number {
  return stages.find((s) => s.stage === id)?.count || 0;
}

/* ─── Team score ─── */

export function calcAgentScore(m: TeamMember): number {
  let score = 70;
  if (m.overdueTasks > 0) score -= Math.min(30, m.overdueTasks * 5);
  if (m.pendingTasks > 10) score -= Math.min(15, (m.pendingTasks - 10) * 1.5);
  if (m.totalCollected > 0) score += Math.min(20, (m.totalCollected / 10000) * 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/* ─── CSV Export ─── */

export function exportDashboardCSV(data: DashboardData, isAdmin: boolean) {
  const rows: string[] = [];

  rows.push('ESTATISTICAS GERAIS');
  rows.push('Metrica,Valor');
  rows.push(`Conversas Abertas,${data.conversations.open}`);
  rows.push(`Tarefas Pendentes,${data.tasks.pending + data.tasks.inProgress}`);
  rows.push(`Tarefas Atrasadas,${data.tasks.overdue}`);
  rows.push(`Casos Ativos,${data.legalCases.total}`);
  rows.push(`Processos,${data.trackingCases.total}`);
  if (data.inboxStats) {
    rows.push(`Atendimentos Encerrados Hoje,${data.inboxStats.closedToday}`);
    rows.push(`Atendimentos Encerrados Esta Semana,${data.inboxStats.closedThisWeek}`);
    rows.push(`Atendimentos Encerrados Este Mes,${data.inboxStats.closedThisMonth}`);
  }
  rows.push('');

  rows.push('PIPELINE DE LEADS');
  rows.push('Etapa,Quantidade');
  for (const item of data.leadPipeline) {
    rows.push(`${item.stage},${item.count}`);
  }
  rows.push('');

  if (isAdmin && data.teamMetrics.length > 0) {
    rows.push('METRICAS DA EQUIPE');
    rows.push('Nome,Funcao,Conversas Abertas,Casos Ativos,Tarefas Pendentes,Tarefas Atrasadas,Recebido,A Receber');
    for (const m of data.teamMetrics) {
      rows.push(`"${m.name}",${m.role},${m.openConversations},${m.activeCases},${m.pendingTasks},${m.overdueTasks},${m.totalCollected},${m.totalReceivable}`);
    }
    rows.push('');
  }

  rows.push('RESUMO FINANCEIRO');
  rows.push('Categoria,Valor (R$)');
  rows.push(`Contratado,${data.financials.totalContracted}`);
  rows.push(`Recebido,${data.financials.totalCollected}`);
  rows.push(`A Receber,${data.financials.totalReceivable}`);
  rows.push(`Em Atraso,${data.financials.totalOverdue}`);
  rows.push(`Parcelas em Atraso,${data.financials.overdueCount}`);

  const csv = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `dashboard_${date}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
