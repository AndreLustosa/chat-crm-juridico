'use client';

import { LogOut, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';

/**
 * Header reutilizavel pras paginas autenticadas do portal.
 * Mostra logo + botao voltar (opcional) + sair.
 */
export function PortalHeader({ showBack = false }: { showBack?: boolean }) {
  const router = useRouter();

  async function logout() {
    await fetch(`${API_BASE}/portal/auth/logout`, { method: 'POST', credentials: 'include' });
    router.push('/portal');
  }

  return (
    <header className="border-b border-white/10 bg-[#0d0d14]/80 backdrop-blur-xl sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {showBack && (
            <button
              onClick={() => router.back()}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Voltar"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/landing/logo_andre_lustosa_transparente.png"
            alt="André Lustosa Advogados"
            className="h-8 w-auto cursor-pointer"
            onClick={() => router.push('/portal')}
          />
          <div className="hidden sm:block w-px h-6 bg-white/20" />
          <span className="hidden sm:block text-xs font-bold text-[#A89048] uppercase tracking-widest">
            Portal do Cliente
          </span>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 text-white/70 hover:text-white text-xs font-bold px-4 py-2 rounded-full hover:bg-white/5 transition-colors"
        >
          <LogOut size={14} />
          Sair
        </button>
      </div>
    </header>
  );
}
