'use client';

import { useEffect, useRef, useState } from 'react';
import type { Corners, Point } from '@/lib/document-scanner';
import { CheckCircle2, X, RotateCcw } from 'lucide-react';

/**
 * Editor visual de cantos do documento. Cliente arrasta 4 handles em cima
 * da foto pra ajustar onde estao as bordas do documento. Usado quando a
 * deteccao automatica errou ou nao conseguiu detectar nada.
 *
 * Suporta touch (mobile) e mouse (desktop). Coordenadas sao mantidas no
 * espaco da imagem ORIGINAL (nao do canvas redimensionado) — assim a
 * funcao de warp recebe pontos corretos sem precisar reajustar escala.
 */

type Props = {
  imageDataUrl: string;
  // Cantos iniciais — vem da deteccao automatica ou de um default
  // (retangulo ocupando 80% da imagem) quando deteccao falhou
  initialCorners: Corners | null;
  onConfirm: (corners: Corners) => void;
  onCancel: () => void;
};

const HANDLE_RADIUS = 16; // raio do circulo arrastavel em pixels de tela
const HIT_RADIUS = 28;    // area de toque maior (mobile-friendly)

type Handle = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

export function CornerEditor({ imageDataUrl, initialCorners, onConfirm, onCancel }: Props) {
  const [corners, setCorners] = useState<Corners | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1); // imagem original / display
  const [activeHandle, setActiveHandle] = useState<Handle | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Carrega imagem e calcula default corners se nao recebeu
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setImgDims({ w, h });
      if (initialCorners) {
        setCorners(initialCorners);
      } else {
        // Default: retangulo a 10% das bordas
        const m = 0.1;
        setCorners({
          topLeft: { x: w * m, y: h * m },
          topRight: { x: w * (1 - m), y: h * m },
          bottomRight: { x: w * (1 - m), y: h * (1 - m) },
          bottomLeft: { x: w * m, y: h * (1 - m) },
        });
      }
    };
    img.src = imageDataUrl;
  }, [imageDataUrl, initialCorners]);

  // Calcula escala display quando container ou imagem muda
  useEffect(() => {
    if (!imgDims || !containerRef.current) return;
    const update = () => {
      const cw = containerRef.current!.clientWidth;
      // Display width = container width (responsivo). Altura proporcional.
      setScale(cw / imgDims.w);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [imgDims]);

  function getEventPoint(e: React.PointerEvent<HTMLDivElement>): { x: number; y: number } {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }

  function findClosestHandle(p: Point): Handle | null {
    if (!corners) return null;
    const handles: [Handle, Point][] = [
      ['topLeft', corners.topLeft],
      ['topRight', corners.topRight],
      ['bottomRight', corners.bottomRight],
      ['bottomLeft', corners.bottomLeft],
    ];
    let best: Handle | null = null;
    let bestDist = HIT_RADIUS / scale; // limite em coords da imagem
    for (const [name, c] of handles) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestDist) {
        best = name;
        bestDist = d;
      }
    }
    return best;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const p = getEventPoint(e);
    const h = findClosestHandle(p);
    if (h) {
      setActiveHandle(h);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!activeHandle || !corners || !imgDims) return;
    const p = getEventPoint(e);
    // Clamp dentro da imagem
    const x = Math.max(0, Math.min(imgDims.w, p.x));
    const y = Math.max(0, Math.min(imgDims.h, p.y));
    setCorners({ ...corners, [activeHandle]: { x, y } });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (activeHandle) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setActiveHandle(null);
    }
  }

  function reset() {
    if (initialCorners) setCorners(initialCorners);
    else if (imgDims) {
      const m = 0.1;
      setCorners({
        topLeft: { x: imgDims.w * m, y: imgDims.h * m },
        topRight: { x: imgDims.w * (1 - m), y: imgDims.h * m },
        bottomRight: { x: imgDims.w * (1 - m), y: imgDims.h * (1 - m) },
        bottomLeft: { x: imgDims.w * m, y: imgDims.h * (1 - m) },
      });
    }
  }

  if (!corners || !imgDims) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0d0d14] p-12 text-center text-white/50 text-sm">
        Carregando…
      </div>
    );
  }

  // Pontos em coords de tela (display) pra renderizar SVG
  const sw = imgDims.w * scale;
  const sh = imgDims.h * scale;
  const dispCorners = {
    topLeft: { x: corners.topLeft.x * scale, y: corners.topLeft.y * scale },
    topRight: { x: corners.topRight.x * scale, y: corners.topRight.y * scale },
    bottomRight: { x: corners.bottomRight.x * scale, y: corners.bottomRight.y * scale },
    bottomLeft: { x: corners.bottomLeft.x * scale, y: corners.bottomLeft.y * scale },
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-white">Ajustar bordas do documento</h3>
        <p className="text-xs text-white/50 mt-0.5">
          Arraste os 4 cantos pra encaixar exatamente nas bordas do documento.
        </p>
      </div>

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative rounded-2xl overflow-hidden bg-black select-none touch-none"
        style={{ width: '100%', height: sh }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imageDataUrl}
          alt="Documento"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          draggable={false}
        />
        <svg
          width={sw}
          height={sh}
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${sw} ${sh}`}
        >
          {/* Sombreamento fora do documento — escurece tudo e faz "buraco"
              no quadrilatero pra destacar a area selecionada */}
          <defs>
            <mask id="doc-mask">
              <rect x="0" y="0" width={sw} height={sh} fill="white" />
              <polygon
                points={`${dispCorners.topLeft.x},${dispCorners.topLeft.y} ${dispCorners.topRight.x},${dispCorners.topRight.y} ${dispCorners.bottomRight.x},${dispCorners.bottomRight.y} ${dispCorners.bottomLeft.x},${dispCorners.bottomLeft.y}`}
                fill="black"
              />
            </mask>
          </defs>
          <rect x="0" y="0" width={sw} height={sh} fill="rgba(0,0,0,0.5)" mask="url(#doc-mask)" />

          {/* Linhas conectando os cantos */}
          <polygon
            points={`${dispCorners.topLeft.x},${dispCorners.topLeft.y} ${dispCorners.topRight.x},${dispCorners.topRight.y} ${dispCorners.bottomRight.x},${dispCorners.bottomRight.y} ${dispCorners.bottomLeft.x},${dispCorners.bottomLeft.y}`}
            fill="none"
            stroke="#A89048"
            strokeWidth="2"
          />

          {/* Handles — circulo dourado com borda branca */}
          {(['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as Handle[]).map(h => (
            <g key={h}>
              <circle
                cx={dispCorners[h].x}
                cy={dispCorners[h].y}
                r={HANDLE_RADIUS}
                fill={activeHandle === h ? '#A89048' : 'rgba(168, 144, 72, 0.85)'}
                stroke="white"
                strokeWidth="2"
              />
              <circle
                cx={dispCorners[h].x}
                cy={dispCorners[h].y}
                r={4}
                fill="white"
              />
            </g>
          ))}
        </svg>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onConfirm(corners)}
          className="flex items-center gap-2 bg-[#A89048] hover:bg-[#B89A50] text-[#0a0a0f] text-sm font-bold px-4 py-2.5 rounded-full transition-colors"
        >
          <CheckCircle2 size={16} />
          Aplicar recorte
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-2 border border-white/15 hover:border-[#A89048]/50 text-white text-sm font-bold px-4 py-2.5 rounded-full transition-colors"
        >
          <RotateCcw size={14} />
          Resetar
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-2 text-white/60 hover:text-white text-sm font-bold px-3 py-2.5 rounded-full hover:bg-white/5 transition-colors ml-auto"
        >
          <X size={16} />
          Cancelar
        </button>
      </div>
    </div>
  );
}
