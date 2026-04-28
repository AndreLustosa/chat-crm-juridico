'use client';

import { useRef, useState, useCallback } from 'react';
import { Mic, Square, X } from 'lucide-react';
import api from '@/lib/api';

interface AudioRecorderProps {
  conversationId: string;
  onSent: (msg: any) => void;
  disabled?: boolean;
  onRecordingStart?: () => void;
}

export function AudioRecorder({ conversationId, onSent, disabled, onRecordingStart }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    // Pre-check: contexto seguro (HTTPS ou localhost) — getUserMedia exige.
    // Em prod o site ja eh HTTPS, mas se rodar em http://IP por acidente
    // o navegador retorna mediaDevices=undefined sem erro claro.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      alert('Microfone só funciona em HTTPS. Acesse o site pelo endereço seguro (cadeado verde na URL).');
      return;
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      alert('Seu navegador não suporta gravação de áudio. Tente Chrome ou Edge atualizado.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prioriza OGG (formato PTT nativo do WhatsApp) → WebM → MP4
      const preferredTypes = [
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
      ];
      const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      setRecording(true);
      onRecordingStart?.();
    } catch (e: any) {
      // Logging detalhado pra debug — cliente reporta 2026-04-28 que erro
      // generico nao ajuda a diagnosticar (Chrome global ok, mas alguma outra
      // camada bloqueando: Windows, antivirus, OS-level, drivers).
      console.error('[AudioRecorder] getUserMedia falhou:', {
        name: e?.name,
        message: e?.message,
        constraint: e?.constraint,
        stack: e?.stack,
      });

      // Mensagem especifica por tipo de erro do DOMException
      const errName = e?.name || '';
      let userMessage: string;
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        userMessage = 'Permissão de microfone negada. Clique no cadeado/ajustes ao lado da URL → Microfone → Permitir → e recarregue a página.';
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        userMessage = 'Nenhum microfone encontrado. Verifique se há um microfone conectado e habilitado em Configurações do Windows → Privacidade → Microfone.';
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        userMessage = 'O microfone está sendo usado por outro programa (Zoom, Meet, OBS, Discord, etc). Feche os outros apps e tente de novo.';
      } else if (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError') {
        userMessage = 'Configuração de microfone incompatível com o navegador.';
      } else if (errName === 'AbortError') {
        userMessage = 'Acesso ao microfone foi interrompido. Tente de novo.';
      } else if (errName === 'SecurityError') {
        userMessage = 'Bloqueio de segurança do navegador. Tente em janela não-anônima ou desabilite extensões de privacidade.';
      } else {
        userMessage = `Erro de microfone (${errName || 'desconhecido'}): ${e?.message || 'sem detalhes'}. Veja o console (F12) pra mais info.`;
      }
      alert(userMessage);
    }
  }, [onRecordingStart]);

  const stopAndSend = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    recorder.onstop = async () => {
      const mimeType = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setSending(true);
      try {
        // Deriva extensão do mimeType real gravado pelo browser
        const clean = mimeType.split(';')[0].trim();
        const extMap: Record<string, string> = {
          'audio/ogg': 'ogg',
          'audio/webm': 'webm',
          'audio/mp4': 'mp4',
          'audio/mpeg': 'mp3',
          'audio/wav': 'wav',
        };
        const ext = extMap[clean] ?? clean.split('/')[1] ?? 'webm';
        const formData = new FormData();
        formData.append('conversationId', conversationId);
        formData.append('audio', blob, `gravacao.${ext}`);
        const res = await api.post('/messages/send-audio', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        onSent(res.data);
      } catch (e) {
        console.error('[AUDIO] Falha ao enviar áudio:', e);
      } finally {
        setSending(false);
      }
    };

    recorder.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  }, [conversationId, onSent]);

  const cancel = useCallback(() => {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
    chunksRef.current = [];
  }, []);

  if (sending) {
    return (
      <div className="flex items-center px-3 py-2 text-xs text-muted-foreground animate-pulse">
        Enviando áudio...
      </div>
    );
  }

  if (recording) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-red-400 font-medium animate-pulse">
          <span className="w-2 h-2 bg-red-500 rounded-full" />
          Gravando...
        </span>
        <button
          onClick={cancel}
          className="p-2 rounded-xl text-muted-foreground hover:bg-accent transition-colors"
          title="Cancelar gravação"
        >
          <X size={18} />
        </button>
        <button
          onClick={stopAndSend}
          className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          title="Parar e enviar"
        >
          <Square size={18} fill="currentColor" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startRecording}
      disabled={disabled}
      className="p-4 rounded-xl bg-muted text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
      title="Gravar áudio"
    >
      <Mic size={20} />
    </button>
  );
}
