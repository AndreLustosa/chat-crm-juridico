'use client';

import { useState, useRef, useEffect } from 'react';
import { Smile } from 'lucide-react';
import dynamic from 'next/dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Picker = dynamic(
  () => import('@emoji-mart/react').then((m: any) => m.default || m.Picker),
  { ssr: false },
) as any;

interface Props {
  onEmojiSelect: (emoji: string) => void;
  compact?: boolean;
}

export function EmojiPickerButton({ onEmojiSelect, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [emojiData, setEmojiData] = useState<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    import('@emoji-mart/data').then((m: any) => setEmojiData(m.default || m));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Emojis"
        className={compact
          ? `p-1.5 rounded-lg transition-colors ${open ? 'text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`
          : `p-3 rounded-xl bg-card border border-border transition-colors ${open ? 'text-primary border-primary/40 bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`
        }
      >
        <Smile size={compact ? 18 : 20} />
      </button>
      {open && emojiData && (
        <div className="absolute bottom-12 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden">
          <Picker
            data={emojiData}
            onEmojiSelect={(e: any) => {
              onEmojiSelect(e.native);
              setOpen(false);
            }}
            locale="pt"
            theme="dark"
            previewPosition="none"
            skinTonePosition="none"
          />
        </div>
      )}
    </div>
  );
}
