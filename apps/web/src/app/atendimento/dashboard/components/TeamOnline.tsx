'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, Wifi } from 'lucide-react';
import api from '@/lib/api';
import { useSocket } from '@/lib/SocketProvider';

interface UserInfo {
  id: string;
  name: string;
  roles: string[];
  online: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin', ADVOGADO: 'Advogado', OPERADOR: 'Operador',
  ESTAGIARIO: 'Estagiário', FINANCEIRO: 'Financeiro', COMERCIAL: 'Comercial',
};

export function TeamOnline() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { socket } = useSocket();

  const fetchUsers = useCallback(async () => {
    try {
      const [usersRes, onlineRes] = await Promise.all([
        api.get('/users?limit=100'),
        api.get('/users/online'),
      ]);
      const allUsers = (usersRes.data?.data || usersRes.data?.users || usersRes.data || []) as any[];
      const onlineIds: string[] = onlineRes.data?.onlineUserIds || [];
      const onlineSet = new Set(onlineIds);

      setUsers(
        allUsers
          .filter((u: any) => u.roles?.length > 0 || u.role)
          .map((u: any) => ({
            id: u.id,
            name: u.name || u.email,
            roles: u.roles || (u.role ? [u.role] : []),
            online: onlineSet.has(u.id),
          }))
          .sort((a: UserInfo, b: UserInfo) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || a.name.localeCompare(b.name))
      );
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Escutar eventos de presença no socket compartilhado
  useEffect(() => {
    if (!socket) return;

    const onPresence = (data: { userId: string; online: boolean }) => {
      setUsers(prev => prev.map(u =>
        u.id === data.userId ? { ...u, online: data.online } : u
      ).sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || a.name.localeCompare(b.name)));
    };

    socket.on('user_presence', onPresence);
    return () => { socket.off('user_presence', onPresence); };
  }, [socket]);

  const onlineCount = users.filter(u => u.online).length;

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Users size={13} className="text-primary" />
          Equipe
        </h3>
        <span className="text-[10px] font-semibold text-emerald-400 flex items-center gap-1">
          <Wifi size={10} /> {onlineCount} online
        </span>
      </div>

      {loading ? (
        <div className="text-[11px] text-muted-foreground text-center py-4">Carregando...</div>
      ) : (
        <div className="space-y-1.5">
          {users.map(user => (
            <div key={user.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-accent/30 transition-colors">
              <div className={`w-2 h-2 rounded-full shrink-0 ${user.online ? 'bg-emerald-500' : 'bg-gray-600'}`} />
              <div className="w-7 h-7 rounded-full bg-accent border border-border flex items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-muted-foreground">
                  {user.name[0]?.toUpperCase() || '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-semibold truncate ${user.online ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {user.name}
                </p>
                <p className="text-[9px] text-muted-foreground">
                  {user.roles.map(r => ROLE_LABELS[r] || r).join(', ')}
                </p>
              </div>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                user.online ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-500/10 text-gray-500'
              }`}>
                {user.online ? 'Online' : 'Offline'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
