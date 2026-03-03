'use client';

import { useState, useRef } from 'react';
import { Mic, MicOff, Trash2, Play, Pause, Square, Loader2 } from 'lucide-react';
import api from '@/lib/api';

interface AudioEntry {
  id: string;       // ID no banco (após upload)
  blob?: Blob;      // blob local (antes do upload ou para playback)
  uploading?: boolean;
  error?: boolean;
  errorMsg?: string; // mensagem de erro do servidor
  duration?: number; // segundos
}

interface Props {
  conversationId: string;
  /** Callback chamado quando a lista de IDs uploadados muda */
  onAudioIdsChange: (ids: string[]) => void;
}

export function TransferAudioRecorder({ conversationId, onAudioIdsChange }: Props) {
  const [recording, setRecording] = useState(false);
  const [audios, setAudios] = useState<AudioEntry[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const startTimeRef = useRef<number>(0);

  const uploadedIds = () => audios.filter(a => a.id && !a.uploading && !a.error).map(a => a.id);

  const startRecording = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : 'audio/webm';

      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      startTimeRef.current = Date.now();

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
        const tempId = `tmp-${Date.now()}`;

        // Add uploading entry
        const entry: AudioEntry = { id: tempId, blob, uploading: true, duration };
        setAudios(prev => {
          const next = [...prev, entry];
          return next;
        });

        // Upload to backend
        try {
          const form = new FormData();
          form.append('audio', blob, `transfer-audio.${mimeType.includes('ogg') ? 'ogg' : 'webm'}`);
          const res = await api.post(`/transfer-audios/upload/${conversationId}`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const realId: string = res.data.id;

          setAudios(prev => {
            const next = prev.map(a => a.id === tempId
              ? { ...a, id: realId, uploading: false }
              : a
            );
            onAudioIdsChange(next.filter(a => !a.uploading && !a.error).map(a => a.id));
            return next;
          });
        } catch (e: any) {
          console.error('[TransferAudio] Upload error', e);
          const serverMsg: string =
            e?.response?.data?.message ||
            (e?.response?.status === 507 ? 'Armazenamento cheio. Contate o administrador.' : 'Falha no upload — remova e tente novamente');
          setAudios(prev => {
            const next = prev.map(a => a.id === tempId ? { ...a, uploading: false, error: true, errorMsg: serverMsg } : a);
            return next;
          });
        }
      };

      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (e) {
      console.error('[TransferAudio] getUserMedia error', e);
      alert('Não foi possível acessar o microfone. Verifique as permissões.');
    }
  };

  const stopRecording = () => {
    if (!recording || !mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setRecording(false);
  };

  const removeAudio = async (id: string) => {
    // Remove localmente primeiro (UX responsiva)
    setAudios(prev => {
      const next = prev.filter(a => a.id !== id);
      onAudioIdsChange(next.filter(a => !a.uploading && !a.error).map(a => a.id));
      return next;
    });
    // Para playback se estiver tocando este áudio
    if (playingId === id) {
      audioRefs.current[id]?.pause();
      setPlayingId(null);
    }
    // Deleta no servidor (não bloqueia UI)
    if (!id.startsWith('tmp-')) {
      api.delete(`/transfer-audios/${id}`).catch(e => console.warn('[TransferAudio] delete error', e));
    }
  };

  const togglePlay = (entry: AudioEntry) => {
    const audioEl = audioRefs.current[entry.id];
    if (!audioEl) return;

    if (playingId === entry.id) {
      audioEl.pause();
      setPlayingId(null);
    } else {
      // Pausar qualquer outro que esteja tocando
      if (playingId && audioRefs.current[playingId]) {
        audioRefs.current[playingId].pause();
      }
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
      setPlayingId(entry.id);
    }
  };

  const formatDur = (sec?: number) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-2">
      {/* Lista de áudios gravados */}
      {audios.length > 0 && (
        <div className="space-y-1.5">
          {audios.map((entry, idx) => (
            <div key={entry.id} className="flex items-center gap-2 bg-muted/50 border border-border rounded-xl px-3 py-2">
              {/* Elemento de áudio invisível para playback */}
              {entry.blob && (
                <audio
                  ref={el => { if (el) audioRefs.current[entry.id] = el; }}
                  src={URL.createObjectURL(entry.blob)}
                  onEnded={() => setPlayingId(null)}
                  className="hidden"
                />
              )}

              {entry.uploading ? (
                <Loader2 size={15} className="animate-spin text-muted-foreground shrink-0" />
              ) : entry.error ? (
                <span className="text-[10px] text-destructive shrink-0">Erro</span>
              ) : (
                <button
                  type="button"
                  onClick={() => togglePlay(entry)}
                  className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0 hover:bg-primary/20 transition-colors"
                  title={playingId === entry.id ? 'Pausar' : 'Ouvir'}
                >
                  {playingId === entry.id ? <Pause size={11} /> : <Play size={11} />}
                </button>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-foreground font-medium">Áudio {idx + 1}</p>
                {entry.duration !== undefined && (
                  <p className="text-[10px] text-muted-foreground">{formatDur(entry.duration)}</p>
                )}
                {entry.uploading && <p className="text-[10px] text-muted-foreground">Enviando...</p>}
                {entry.error && <p className="text-[10px] text-destructive">{entry.errorMsg || 'Falha no upload — remova e tente novamente'}</p>}
              </div>

              <button
                type="button"
                onClick={() => removeAudio(entry.id)}
                className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                title="Remover áudio"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Botão de gravar */}
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
          recording
            ? 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25 animate-pulse'
            : 'bg-muted border-border text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
        title={recording ? 'Parar gravação' : 'Gravar áudio explicativo'}
      >
        {recording ? (
          <>
            <Square size={13} className="fill-red-400" />
            Parar gravação
          </>
        ) : (
          <>
            <Mic size={13} />
            {audios.length > 0 ? 'Gravar outro áudio' : 'Gravar áudio'}
          </>
        )}
      </button>
    </div>
  );
}
