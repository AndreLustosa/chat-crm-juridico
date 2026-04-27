'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, X, AlertCircle, Zap, ZapOff } from 'lucide-react';

/**
 * Camera ao vivo dentro da app (estilo CamScanner) — usa getUserMedia em
 * vez de <input capture>. Vantagens sobre o input nativo:
 *   - Cliente nao sai do app pro app de camera do sistema
 *   - Captura com 1 clique sem confirmar/cancelar tela cheia
 *   - Botao "Adicionar proxima pagina" eh imediato — sem reabrir a camera
 *   - Possibilidade futura de overlay em tempo real (deteccao de bordas)
 *
 * Requisitos:
 *   - HTTPS (ou localhost) — getUserMedia bloqueia HTTP nao-seguro
 *   - Permissao de camera do usuario
 *
 * Se permissao negada ou getUserMedia indisponivel, props.onFallback eh
 * chamado pra caller cair no <input capture> nativo.
 */

type Props = {
  onCapture: (file: File) => void;
  onClose: () => void;
  onFallback: () => void;
};

type State = 'requesting' | 'ready' | 'capturing' | 'denied' | 'error';

export function LiveScanner({ onCapture, onClose, onFallback }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<State>('requesting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  // Pede permissao + abre stream da camera traseira
  useEffect(() => {
    let cancelled = false;

    async function start() {
      // Sanity check: getUserMedia disponivel?
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setState('error');
        setErrorMsg('Câmera ao vivo não disponível nesse navegador');
        return;
      }

      try {
        // facingMode 'environment' = camera traseira no celular. Em desktop
        // pega webcam principal (geralmente frontal — sem alternativa).
        // Resolucao alta sem ser absurda — 1920 max pra ja vir comprimido
        // pelo proprio video.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // iOS Safari precisa playsinline + muted pra autoplay funcionar
          videoRef.current.playsInline = true;
          videoRef.current.muted = true;
          await videoRef.current.play().catch(() => {});
        }

        // Detecta suporte a flash (torch) — disponivel so em mobile com
        // camera traseira na maioria dos navegadores
        const track = stream.getVideoTracks()[0];
        const capabilities: any = track.getCapabilities?.() || {};
        if (capabilities.torch) {
          setTorchSupported(true);
        }

        setState('ready');
      } catch (e: any) {
        if (cancelled) return;
        if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
          setState('denied');
          setErrorMsg('Você precisa permitir o acesso à câmera pra usar o scanner');
        } else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
          setState('error');
          setErrorMsg('Nenhuma câmera encontrada nesse dispositivo');
        } else {
          setState('error');
          setErrorMsg(e?.message || 'Falha ao abrir a câmera');
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      // Para o stream ao desmontar pra liberar a camera
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: next } as any],
      });
      setTorchOn(next);
    } catch {
      // alguns dispositivos prometem suporte mas falham — desabilita silenciosamente
      setTorchSupported(false);
    }
  }

  /**
   * Captura o frame atual do video pra um canvas, gera Blob JPEG e
   * devolve como File. Roda 100% client-side, nao re-acessa a camera.
   */
  async function capture() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    setState('capturing');
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas indisponivel');
      ctx.drawImage(video, 0, 0, w, h);

      const blob: Blob | null = await new Promise(resolve => {
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.92);
      });
      if (!blob) throw new Error('Falha ao gerar imagem');

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = new File([blob], `pagina-${ts}.jpg`, { type: 'image/jpeg' });
      onCapture(file);
      setState('ready'); // pronto pra proxima foto
    } catch (e: any) {
      setErrorMsg(e?.message || 'Falha ao capturar');
      setState('ready');
    }
  }

  // Tela de erro (incluindo permissao negada) — oferece fallback pra <input capture>
  if (state === 'denied' || state === 'error') {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className="text-red-400 mt-0.5 shrink-0" size={20} />
          <div>
            <p className="text-red-400 font-bold text-sm">
              {state === 'denied' ? 'Acesso à câmera negado' : 'Erro na câmera'}
            </p>
            <p className="text-red-400/70 text-xs mt-1">{errorMsg}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onFallback}
            className="bg-[#A89048] hover:bg-[#B89A50] text-[#0a0a0f] text-sm font-bold px-4 py-2 rounded-full transition-colors"
          >
            Usar câmera do celular
          </button>
          <button
            onClick={onClose}
            className="border border-white/15 hover:border-white/30 text-white text-sm font-bold px-4 py-2 rounded-full transition-colors"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 backdrop-blur-sm">
        <button
          onClick={onClose}
          className="p-2 rounded-full text-white/80 hover:bg-white/10 transition-colors"
          aria-label="Fechar câmera"
        >
          <X size={20} />
        </button>
        <span className="text-white text-sm font-bold">Scanner</span>
        {torchSupported ? (
          <button
            onClick={toggleTorch}
            className={`p-2 rounded-full transition-colors ${
              torchOn ? 'bg-[#A89048] text-[#0a0a0f]' : 'text-white/80 hover:bg-white/10'
            }`}
            aria-label="Alternar flash"
          >
            {torchOn ? <Zap size={18} /> : <ZapOff size={18} />}
          </button>
        ) : (
          <span className="w-9" /> // placeholder pra centralizar titulo
        )}
      </div>

      {/* Video — flex-1 ocupa o espaco entre topbar e botao de captura */}
      <div className="flex-1 relative bg-black overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain"
          playsInline
          muted
          autoPlay
        />
        {state === 'requesting' && (
          <div className="absolute inset-0 flex items-center justify-center text-white/60">
            <Loader2 className="animate-spin mr-2" size={20} />
            <span className="text-sm">Abrindo câmera…</span>
          </div>
        )}

        {/* Frame guide — retangulo pontilhado mostrando "enquadre o documento aqui" */}
        {state === 'ready' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8">
            <div className="w-full h-full max-w-md max-h-[80%] border-2 border-dashed border-[#A89048]/50 rounded-2xl" />
          </div>
        )}
      </div>

      {/* Bottom — botao de captura grande estilo Camera nativa */}
      <div className="px-6 py-6 bg-black/80 backdrop-blur-sm flex items-center justify-center">
        <button
          onClick={capture}
          disabled={state !== 'ready'}
          className="relative w-20 h-20 rounded-full bg-white disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center"
          aria-label="Tirar foto"
        >
          <div className="absolute inset-1.5 rounded-full border-4 border-[#0a0a0f]" />
          <div className="absolute inset-3 rounded-full bg-white" />
          {state === 'capturing' && (
            <Loader2 className="animate-spin absolute text-[#0a0a0f]" size={28} />
          )}
        </button>
      </div>
    </div>
  );
}
