'use client';

import { useState, useEffect } from 'react';
import { Bell, Volume2, Play } from 'lucide-react';
import {
  NOTIFICATION_SOUNDS,
  getNotificationSoundId,
  setNotificationSoundId,
  playNotificationSound,
  type SoundId,
} from '@/lib/notificationSounds';

export default function NotificationsSettingsPage() {
  const [selected, setSelected] = useState<SoundId>('ding');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSelected(getNotificationSoundId());
  }, []);

  const handleSelect = (id: SoundId) => {
    setSelected(id);
    setNotificationSoundId(id);
    playNotificationSound(id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Bell className="text-primary" size={22} />
          <h1 className="text-2xl font-bold">Notificações</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure o som de alerta para novas mensagens recebidas.
        </p>
      </div>

      {/* Sound selector */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-3 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <Volume2 size={15} className="text-muted-foreground" />
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Som de Notificação
          </h2>
          {saved && (
            <span className="ml-auto text-xs text-primary font-semibold animate-fade-in">
              ✓ Salvo
            </span>
          )}
        </div>

        <div className="grid gap-2.5">
          {NOTIFICATION_SOUNDS.map((sound) => {
            const isActive = selected === sound.id;
            return (
              <div
                key={sound.id}
                onClick={() => handleSelect(sound.id)}
                className={`flex items-center justify-between px-4 py-3.5 rounded-xl border cursor-pointer transition-all ${
                  isActive
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-border bg-muted/20 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Radio indicator */}
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isActive ? 'border-primary' : 'border-muted-foreground/40'
                    }`}
                  >
                    {isActive && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <div>
                    <p className={`font-semibold text-[14px] ${isActive ? 'text-primary' : 'text-foreground'}`}>
                      {sound.label}
                    </p>
                    <p className={`text-[12px] ${isActive ? 'text-primary/70' : 'text-muted-foreground'}`}>
                      {sound.description}
                    </p>
                  </div>
                </div>

                {/* Preview button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    playNotificationSound(sound.id);
                  }}
                  title="Ouvir prévia"
                  className={`p-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary/20 hover:bg-primary/30 text-primary'
                      : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Play size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Info box */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="text-sm font-semibold mb-3">Como funciona</h3>
        <ul className="space-y-2.5 text-[13px] text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5 shrink-0">•</span>
            <span>
              O som é tocado quando você recebe uma nova mensagem em uma conversa atribuída a você.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5 shrink-0">•</span>
            <span>
              A preferência é salva por dispositivo — ao clicar em um som ele já fica ativo automaticamente.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5 shrink-0">•</span>
            <span>
              Clique em <Play size={11} className="inline mx-0.5 align-middle" /> ao lado de cada som para ouvir uma prévia.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
