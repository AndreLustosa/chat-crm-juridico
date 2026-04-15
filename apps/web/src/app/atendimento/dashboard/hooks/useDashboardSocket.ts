'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSocket } from '@/lib/SocketProvider';
import type { DashboardData } from '../types';

/**
 * Listens for dashboard updates on the shared socket.
 * Falls back to polling every 5 minutes if socket is not connected.
 */
export function useDashboardSocket(
  onUpdate: (partial: Partial<DashboardData>) => void,
  refetch: () => void,
) {
  const { socket, connected } = useSocket();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(refetch, 5 * 60 * 1000);
  }, [refetch]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!socket) { startPolling(); return; }

    if (connected) {
      socket.emit('dashboard:join');
      stopPolling();
    } else {
      startPolling();
    }

    const onDashboardUpdate = (data: Partial<DashboardData>) => {
      onUpdate(data);
    };

    socket.on('dashboard:update', onDashboardUpdate);
    socket.on('disconnect', startPolling);

    return () => {
      socket.off('dashboard:update', onDashboardUpdate);
      socket.off('disconnect', startPolling);
      stopPolling();
    };
  }, [socket, connected, onUpdate, startPolling, stopPolling]);
}
