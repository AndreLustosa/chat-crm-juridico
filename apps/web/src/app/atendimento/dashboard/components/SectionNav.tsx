'use client';

import { SECTION_META, type SectionId } from '../sectionVisibility';

interface Props {
  sections: SectionId[];
}

/**
 * Barra de navegação sticky com âncoras para as seções visíveis.
 * Renderizada apenas se houver 2+ seções.
 */
export function SectionNav({ sections }: Props) {
  if (sections.length < 2) return null;

  return (
    <nav className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {sections.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {SECTION_META[id].title}
          </a>
        ))}
      </div>
    </nav>
  );
}
