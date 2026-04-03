export type SoundId = 'ding' | 'chime' | 'pop' | 'swoosh' | 'bell';

export interface SoundDef {
  id: SoundId;
  label: string;
  description: string;
}

export const NOTIFICATION_SOUNDS: SoundDef[] = [
  { id: 'ding',   label: 'Ding',       description: 'Sino simples e suave' },
  { id: 'chime',  label: 'Chime',      description: 'Dois tons ascendentes' },
  { id: 'pop',    label: 'Pop',        description: 'Bolha leve' },
  { id: 'swoosh', label: 'Swoosh',     description: 'Varredura ascendente' },
  { id: 'bell',   label: 'Sino Rico',  description: 'Sino com harmônicos' },
];

const STORAGE_KEY = 'notification_sound_id';

export function getNotificationSoundId(): SoundId {
  if (typeof window === 'undefined') return 'ding';
  return (localStorage.getItem(STORAGE_KEY) as SoundId) || 'ding';
}

export function setNotificationSoundId(id: SoundId): void {
  localStorage.setItem(STORAGE_KEY, id);
}

// ─── Singleton AudioContext ───────────────────────────────────────
// Browsers block audio until a user gesture. Creating a new AudioContext per
// call means it always starts in "suspended" state when triggered by a socket
// event (no gesture). We keep one instance and resume it when needed.

let _audioCtx: AudioContext | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!_audioCtx) {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      _audioCtx = new AC() as AudioContext;
    } catch {
      return null;
    }
  }
  return _audioCtx;
}

/**
 * Call this on the first user interaction (click, keydown) to unlock the
 * AudioContext so that subsequent notification sounds play without a gesture.
 */
export function unlockAudioContext(): void {
  const ctx = getOrCreateAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// ─── Sound generators ────────────────────────────────────────────

function playDing(ctx: AudioContext) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.38, t + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  osc.start(t);
  osc.stop(t + 0.9);
}

function playChime(ctx: AudioContext) {
  const notes = [659.25, 783.99]; // E5, G5
  notes.forEach((freq, i) => {
    const delay = i * 0.22;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}

function playPop(ctx: AudioContext) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(280, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.start(t);
  osc.stop(t + 0.12);
}

function playSwoosh(ctx: AudioContext) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(350, t);
  osc.frequency.exponentialRampToValueAtTime(1100, t + 0.28);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.3, t + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  osc.start(t);
  osc.stop(t + 0.35);
}

function playBell(ctx: AudioContext) {
  const t = ctx.currentTime;
  const harmonics: [number, number][] = [
    [440, 0.40],  // A4 fundamental
    [880, 0.20],  // A5
    [1100, 0.15], // C#6 approx
    [1320, 0.10], // E6 approx
  ];
  harmonics.forEach(([freq, vol]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.start(t);
    osc.stop(t + 1.4);
  });
}

function _doPlay(ctx: AudioContext, id: string) {
  try {
    switch (id) {
      case 'chime':  playChime(ctx);  break;
      case 'pop':    playPop(ctx);    break;
      case 'swoosh': playSwoosh(ctx); break;
      case 'bell':   playBell(ctx);   break;
      default:       playDing(ctx);   break;
    }
  } catch (e) {
    console.warn('[NotificationSound] Falha ao reproduzir som:', e);
  }
}

export function playNotificationSound(soundId?: SoundId | string): void {
  if (typeof window === 'undefined') return;
  const id: string = soundId ?? getNotificationSoundId();
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    // Resume then play — Promise resolves async but scheduling is relative to
    // ctx.currentTime so timing stays accurate after resume.
    ctx.resume().then(() => _doPlay(ctx, id)).catch(() => {});
  } else {
    _doPlay(ctx, id);
  }
}
