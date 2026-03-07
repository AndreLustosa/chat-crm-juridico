'use client';

import { useEffect } from 'react';

export default function AtendimentoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Atendimento] Erro capturado pelo Error Boundary:', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="text-center p-8 max-w-md">
        <div className="text-5xl mb-4">&#9888;&#65039;</div>
        <h2 className="text-xl font-semibold mb-2 text-foreground">Algo deu errado</h2>
        <p className="text-muted-foreground mb-6">
          Ocorreu um erro inesperado no atendimento. Tente recarregar a pagina.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition font-medium"
          >
            Tentar novamente
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 border border-border text-foreground rounded-lg hover:bg-muted transition font-medium"
          >
            Recarregar pagina
          </button>
        </div>
      </div>
    </div>
  );
}
