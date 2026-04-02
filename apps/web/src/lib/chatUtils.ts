/** Utilidades compartilhadas entre componentes do chat.
 *  Evita duplicacao de funcoes em page.tsx, InboxSidebar, MessageBubble, etc. */

export function getDateKey(dateStr: string): string {
  return new Date(dateStr).toDateString();
}

export function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function getInitial(name?: string): string {
  return (name || 'V')[0].toUpperCase();
}

export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(t);
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

/** Mapa de MIME type para label legivel (PDF, DOCX, etc.) */
export function getDocLabel(mime: string, name?: string): string {
  if (name) {
    const p = name.split('.');
    if (p.length > 1) return p.pop()!.toUpperCase();
  }
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  };
  return map[mime] || 'FILE';
}
