'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { DashboardData } from '../types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Connects to the dashboard socket room and listens for incremental updates.
 * Falls back to polling every 5 minutes if the socket disconnects.
 */
export function useDashboardSocket(
  onUpdate: (partial: Partial<DashboardData>) => void,
  refetch: () => void,
) {
  const socketRef = useRef<Socket | null>(null);
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
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) { startPolling(); return; }

    const socket = io(API_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('dashboard:join');
      stopPolling();
    });

    socket.on('dashboard:update', (data: Partial<DashboardData>) => {
      onUpdate(data);
    });

    socket.on('disconnect', () => {
      startPolling();
    });

    return () => {
      socket.disconnect();
      stopPolling();
    };
  }, [onUpdate, startPolling, stopPolling]);
}
