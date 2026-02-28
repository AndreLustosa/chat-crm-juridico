'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';

const themes = [
  { id: 'logo-dark', name: 'Logo Dark', color: '#000000', border: '#a1773d' },
  { id: 'logo-light', name: 'Logo Light', color: '#fafafa', border: '#a1773d' },
  { id: 'modern-dark', name: 'Modern Dark', color: '#0a0a0f', border: '#7c5cfc' },
  { id: 'modern-light', name: 'Modern Light', color: '#f8fafc', border: '#4f46e5' },
  { id: 'rose-light', name: 'Rose Light', color: '#fff1f2', border: '#e11d48' },
];

export function ThemeSwitcher() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // useEffect only runs on the client, so now we can safely show the UI
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="flex flex-col space-y-3 mt-6 p-4 bg-gray-50/50 dark:bg-black/20 rounded-xl border border-gray-100 dark:border-gray-800/50">
      <div className="flex items-center text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">
        <Palette className="w-4 h-4 mr-2" />
        Aparência
      </div>
      <div className="flex flex-wrap gap-2">
        {themes.map((t) => {
          const isActive = theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`relative flex px-3 py-1.5 rounded-full text-[11px] font-bold transition-all border
                ${isActive 
                  ? 'ring-2 ring-offset-1 dark:ring-offset-gray-900 ring-ring opacity-100 border-transparent shadow-sm' 
                  : 'border-border opacity-70 hover:opacity-100 hover:border-gray-300 dark:hover:border-gray-600'
                }
              `}
              style={{
                backgroundColor: t.color,
                color: t.id.includes('light') ? '#111' : '#fff',
                borderColor: isActive ? t.border : undefined,
              }}
              title={t.name}
            >
              {t.name}
              {isActive && (
                <span 
                  className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-white dark:border-gray-900" 
                  style={{ backgroundColor: t.border }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
