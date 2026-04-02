'use client';

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { AlertTriangle, Clock, CheckCircle2, X, Bell } from 'lucide-react';

interface TaskAlert {
  taskId: string;
  title: string;
  level: 'critical' | 'urgent';
  message: string;
  client?: string;
  caseNumber?: string;
  receivedAt: number;
}

/**
 * Popup de alerta de tarefas — aparece automaticamente quando:
 * - Tarefa está prestes a vencer (nível urgent)
 * - Tarefa está vencida (nível critical)
 *
 * Reaparece a cada 30 min enquanto a tarefa não for concluída.
 * O usuário pode dispensar (some por 30 min) ou marcar como vista.
 */
export function TaskAlertPopup() {
  const [alerts, setAlerts] = useState<TaskAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [socket, setSocket] = useState<Socket | null>(null);

  // Conectar ao socket
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL
        || (apiUrl.startsWith('http') ? new URL(apiUrl).origin : apiUrl);
      const isDev = apiUrl.includes('localhost') || /https?:\/\/[^/]+:\d{4,}/.test(apiUrl);
      const socketPath = process.env.NEXT_PUBLIC_SOCKET_PATH || (isDev ? '/socket.io/' : '/api/socket.io/');

      const s = io(wsUrl, {
        path: socketPath,
        transports: ['polling', 'websocket'],
        auth: { token },
      });

      // Entrar no room do usuário para receber alertas
      s.on('connect', () => {
        try {
          const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload?.sub) s.emit('join_user', payload.sub);
        } catch {}
      });

      s.on('task_overdue_alert', (data: any) => {
        setAlerts(prev => {
          // Evitar duplicata do mesmo task
          if (prev.some(a => a.taskId === data.taskId)) return prev;
          const alert: TaskAlert = {
            taskId: data.taskId,
            title: data.title,
            level: data.level || 'urgent',
            message: data.message || '',
            client: data.client,
            caseNumber: data.caseNumber,
            receivedAt: Date.now(),
          };
          return [alert, ...prev].slice(0, 10);
        });

        // Som de notificação
        try {
          const audio = new Audio('/sounds/notification.mp3');
          audio.volume = 0.5;
          audio.play().catch(() => {});
        } catch {}
      });

      s.on('notification_update', () => {
        // Refresh silencioso — só limpa dismissed para permitir re-alertas
        setDismissed(new Set());
      });

      setSocket(s);
      return () => { s.disconnect(); };
    } catch {}
  }, []);

  // Dismiss temporário (30 min)
  const dismissAlert = useCallback((taskId: string) => {
    setDismissed(prev => new Set(prev).add(taskId));
    setAlerts(prev => prev.filter(a => a.taskId !== taskId));
    // Re-permitir após 30 min
    setTimeout(() => {
      setDismissed(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }, 30 * 60 * 1000);
  }, []);

  // Dismiss todos
  const dismissAll = useCallback(() => {
    const ids = alerts.map(a => a.taskId);
    setAlerts([]);
    setDismissed(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
    // Re-permitir após 30 min
    setTimeout(() => {
      setDismissed(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    }, 30 * 60 * 1000);
  }, [alerts]);

  // Filtrar dismissed
  const visibleAlerts = alerts.filter(a => !dismissed.has(a.taskId));

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {/* Botão dismiss all */}
      {visibleAlerts.length > 1 && (
        <button
          onClick={dismissAll}
          className="pointer-events-auto self-end px-3 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground bg-card/90 backdrop-blur border border-border rounded-lg transition-colors"
        >
          Dispensar todos ({visibleAlerts.length})
        </button>
      )}

      {visibleAlerts.map((alert) => (
        <div
          key={alert.taskId}
          className={`pointer-events-auto p-4 rounded-xl border shadow-2xl backdrop-blur-sm animate-in slide-in-from-right duration-300 ${
            alert.level === 'critical'
              ? 'bg-red-950/95 border-red-500/40'
              : 'bg-amber-950/95 border-amber-500/40'
          }`}
        >
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
              alert.level === 'critical' ? 'bg-red-500/20' : 'bg-amber-500/20'
            }`}>
              {alert.level === 'critical'
                ? <AlertTriangle size={18} className="text-red-400" />
                : <Clock size={18} className="text-amber-400" />
              }
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  alert.level === 'critical' ? 'text-red-400' : 'text-amber-400'
                }`}>
                  {alert.level === 'critical' ? 'Tarefa Vencida' : 'Tarefa Vencendo'}
                </span>
              </div>
              <h4 className="text-sm font-bold text-foreground leading-tight">{alert.title}</h4>
              <p className={`text-xs mt-0.5 ${alert.level === 'critical' ? 'text-red-300/70' : 'text-amber-300/70'}`}>
                {alert.message}
              </p>
              {(alert.client || alert.caseNumber) && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {alert.client && `👤 ${alert.client}`}
                  {alert.client && alert.caseNumber && ' · '}
                  {alert.caseNumber && `📁 ${alert.caseNumber}`}
                </p>
              )}
            </div>

            {/* Dismiss */}
            <button
              onClick={() => dismissAlert(alert.taskId)}
              className="shrink-0 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
              title="Dispensar por 30 min"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
