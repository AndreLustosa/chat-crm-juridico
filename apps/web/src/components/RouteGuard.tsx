'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield } from 'lucide-react';
import { useRole, AppRole } from '@/lib/useRole';

interface RouteGuardProps {
  /** Roles que têm acesso. Se vazio, qualquer usuário autenticado passa. */
  allowedRoles: AppRole[];
  /** Para onde redirecionar em caso de acesso negado. Default: /atendimento */
  redirectTo?: string;
  children: React.ReactNode;
}

/**
 * Protege uma rota por role no client-side.
 * Renderiza children somente se o usuário logado tiver um dos roles permitidos.
 * Caso contrário, redireciona para redirectTo após breve feedback visual.
 */
export function RouteGuard({
  allowedRoles,
  redirectTo = '/atendimento',
  children,
}: RouteGuardProps) {
  const router = useRouter();
  const { role } = useRole();
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!role) {
      // Sem role → não autenticado → redireciona para login
      router.replace('/atendimento/login');
      return;
    }
    if (allowedRoles.length === 0 || allowedRoles.includes(role)) {
      setAllowed(true);
    } else {
      // Tem role mas não tem acesso → redireciona
      router.replace(redirectTo);
    }
    setChecked(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!checked) return null;

  if (!allowed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <Shield className="w-8 h-8 text-destructive/60" />
        </div>
        <div>
          <h3 className="text-base font-bold text-foreground">Acesso não autorizado</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            Você não tem permissão para acessar esta página.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
