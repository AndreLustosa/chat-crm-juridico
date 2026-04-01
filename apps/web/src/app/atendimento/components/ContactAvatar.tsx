'use client';

import { useState } from 'react';

interface ContactAvatarProps {
  /** URL da foto (pode ser null/undefined) */
  src?: string | null;
  /** Nome do contato — usado para gerar a inicial de fallback */
  name?: string | null;
  /** Tamanho em classes Tailwind (padrão: w-10 h-10) */
  sizeClass?: string;
  /** Classes extras para o container */
  className?: string;
  /** Chamado ao clicar quando há foto disponível */
  onClick?: (url: string) => void;
}

function getInitial(name?: string | null) {
  return (name || 'V')[0].toUpperCase();
}

/**
 * Avatar de contato com fallback robusto:
 * - Exibe a foto quando a URL é válida
 * - Quando a URL expira ou falha (WhatsApp CDN tem TTL curto),
 *   cai automaticamente para a inicial do contato
 */
export function ContactAvatar({ src, name, sizeClass = 'w-10 h-10', className = '', onClick }: ContactAvatarProps) {
  const [imgError, setImgError] = useState(false);

  const showImg = !!src && !imgError;

  const containerClass = [
    sizeClass,
    'rounded-full bg-accent border border-border flex items-center justify-center overflow-hidden shadow-sm shrink-0',
    showImg && onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : '',
    className,
  ].join(' ');

  return (
    <div
      className={containerClass}
      onClick={showImg && onClick ? () => onClick(src!) : undefined}
      title={showImg && onClick ? 'Ver foto ampliada' : undefined}
    >
      {showImg ? (
        <img
          src={src}
          alt={name || ''}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="text-foreground font-bold text-lg select-none">
          {getInitial(name)}
        </span>
      )}
    </div>
  );
}
