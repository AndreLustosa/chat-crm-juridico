"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";

type RevealProps = {
  className?: string;
  style?: CSSProperties;
  /** Estado inicial (oculto). Default: fade + sobe 24px. */
  from?: CSSProperties;
  /** Duração da transição, em segundos. */
  duration?: number;
  /** Atraso, em segundos (para escalonar itens de uma lista/grid). */
  delay?: number;
  /** Anima uma vez (default) ou sempre que (re)entra na viewport. */
  once?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
  children?: ReactNode;
};

const DEFAULT_FROM: CSSProperties = {
  opacity: 0,
  transform: "translateY(24px)",
};

/**
 * Substituto leve do `motion.div whileInView` do framer-motion.
 * Usa IntersectionObserver + transition CSS — ~1KB no lugar dos ~40KB do
 * framer-motion, tirando JS do caminho crítico e melhorando o LCP no mobile.
 *
 * Respeita `prefers-reduced-motion` (mostra na hora, sem animar) e degrada
 * para conteúdo visível caso IntersectionObserver não exista.
 */
export function Reveal({
  className,
  style,
  from,
  duration = 0.7,
  delay = 0,
  once = true,
  onClick,
  children,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      // Fallback intencional, dispara uma vez: movimento reduzido ou ambiente
      // sem IntersectionObserver → mostra o conteúdo imediatamente.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setShown(false);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -80px 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [once]);

  const hidden = from ?? DEFAULT_FROM;

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={className}
      style={{
        ...style,
        ...(shown ? null : hidden),
        transition: `opacity ${duration}s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s, transform ${duration}s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
