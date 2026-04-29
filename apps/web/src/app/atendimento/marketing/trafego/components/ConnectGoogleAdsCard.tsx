'use client';

import { useState } from 'react';
import { Loader2, ExternalLink, Shield, AlertCircle } from 'lucide-react';
import api from '@/lib/api';
import { showError } from '@/lib/toast';

interface ConnectGoogleAdsCardProps {
  onConnected?: () => void;
  canManage: boolean;
}

export function ConnectGoogleAdsCard({ canManage }: ConnectGoogleAdsCardProps) {
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    if (!canManage) return;
    setLoading(true);
    try {
      const { data } = await api.get<{ authorize_url: string }>(
        '/trafego/oauth/start',
      );
      // Redireciona pra Google. Ao voltar, /trafego/oauth/callback redireciona
      // pra esta pagina com ?oauth=success ou ?oauth=error.
      window.location.href = data.authorize_url;
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Erro desconhecido';
      showError(`Falha ao iniciar OAuth: ${msg}`);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto bg-card border border-border rounded-2xl p-8 shadow-sm">
      <div className="flex flex-col items-center text-center gap-4 mb-6">
        {/* Logo G Ads (SVG inline pra evitar dependencia) */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="w-9 h-9 fill-white"
            aria-hidden
          >
            <path d="M12 2 2 19l4 3 6-10 6 10 4-3z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground mb-1">
            Conecte sua conta Google Ads
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Autorize o acesso somente leitura para começar a sincronizar
            métricas, gerar relatórios e receber alertas operacionais.
          </p>
        </div>
      </div>

      {/* Itens do que sera feito */}
      <ul className="space-y-2.5 mb-6 text-sm">
        <li className="flex items-start gap-2.5">
          <Shield size={16} className="text-emerald-500 mt-0.5 shrink-0" />
          <span>
            Acesso <strong>somente leitura</strong> — não criamos nem editamos
            campanhas via API
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <Shield size={16} className="text-emerald-500 mt-0.5 shrink-0" />
          <span>
            Refresh token armazenado <strong>criptografado (AES-256)</strong>{' '}
            no banco — pode revogar a qualquer momento
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <Shield size={16} className="text-emerald-500 mt-0.5 shrink-0" />
          <span>
            Sincronização automática <strong>diária às 06h</strong> (Maceió)
          </span>
        </li>
      </ul>

      {!canManage && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            Apenas usuários com perfil <strong>ADMIN</strong> podem conectar
            uma conta Google Ads. Peça para o administrador realizar essa
            etapa.
          </span>
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={loading || !canManage}
        className="w-full flex items-center justify-center gap-2.5 bg-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-md hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Redirecionando...
          </>
        ) : (
          <>
            <ExternalLink size={18} />
            Conectar com Google
          </>
        )}
      </button>

      <p className="mt-4 text-[11px] text-muted-foreground text-center leading-relaxed">
        Ao continuar você será redirecionado para a tela de consentimento da
        Google. Apenas o escopo{' '}
        <code className="px-1 py-0.5 bg-muted rounded text-[10px]">
          adwords
        </code>{' '}
        é solicitado.
      </p>
    </div>
  );
}
