'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { useEffect, useCallback } from 'react';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Highlighter,
  Undo2, Redo2,
  Minus,
} from 'lucide-react';

interface TiptapEditorProps {
  initialContent?: any;       // Tiptap JSON
  placeholder?: string;
  onChange?: (json: any, html: string) => void;
  editable?: boolean;
  className?: string;
}

export default function TiptapEditor({
  initialContent,
  placeholder = 'Comece a digitar...',
  onChange,
  editable = true,
  className = '',
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({ multicolor: false }),
    ],
    content: initialContent || '',
    editable,
    onUpdate: ({ editor }) => {
      if (onChange) {
        onChange(editor.getJSON(), editor.getHTML());
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[300px] px-6 py-4',
      },
    },
    // Evitar SSR hydration mismatch
    immediatelyRender: false,
  });

  // Atualizar conteúdo quando initialContent muda externamente
  useEffect(() => {
    if (editor && initialContent && !editor.isDestroyed) {
      const currentJson = JSON.stringify(editor.getJSON());
      const newJson = JSON.stringify(initialContent);
      if (currentJson !== newJson) {
        editor.commands.setContent(initialContent);
      }
    }
  }, [editor, initialContent]);

  if (!editor) {
    return (
      <div className={`border border-base-300 rounded-lg ${className}`}>
        <div className="h-12 bg-base-200 rounded-t-lg animate-pulse" />
        <div className="min-h-[300px] p-6 animate-pulse" />
      </div>
    );
  }

  return (
    <div className={`border border-base-300 rounded-lg overflow-hidden ${className}`}>
      {/* Toolbar */}
      {editable && <Toolbar editor={editor} />}

      {/* Editor content */}
      <EditorContent editor={editor} />
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────

function Toolbar({ editor }: { editor: any }) {
  const btn = useCallback(
    (isActive: boolean) =>
      `btn btn-ghost btn-xs btn-square ${isActive ? 'bg-primary/20 text-primary' : ''}`,
    [],
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-base-300 bg-base-200/50 px-2 py-1.5">
      {/* Text formatting */}
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btn(editor.isActive('bold'))}
        title="Negrito"
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btn(editor.isActive('italic'))}
        title="Itálico"
      >
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={btn(editor.isActive('underline'))}
        title="Sublinhado"
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={btn(editor.isActive('strike'))}
        title="Tachado"
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        className={btn(editor.isActive('highlight'))}
        title="Destaque"
      >
        <Highlighter className="h-3.5 w-3.5" />
      </button>

      <div className="divider divider-horizontal mx-0.5 w-px h-5 bg-base-300" />

      {/* Headings */}
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={btn(editor.isActive('heading', { level: 1 }))}
        title="Título 1"
      >
        <Heading1 className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={btn(editor.isActive('heading', { level: 2 }))}
        title="Título 2"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={btn(editor.isActive('heading', { level: 3 }))}
        title="Título 3"
      >
        <Heading3 className="h-3.5 w-3.5" />
      </button>

      <div className="divider divider-horizontal mx-0.5 w-px h-5 bg-base-300" />

      {/* Lists */}
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btn(editor.isActive('bulletList'))}
        title="Lista com marcadores"
      >
        <List className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btn(editor.isActive('orderedList'))}
        title="Lista numerada"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </button>

      <div className="divider divider-horizontal mx-0.5 w-px h-5 bg-base-300" />

      {/* Alignment */}
      <button
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        className={btn(editor.isActive({ textAlign: 'left' }))}
        title="Alinhar à esquerda"
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        className={btn(editor.isActive({ textAlign: 'center' }))}
        title="Centralizar"
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        className={btn(editor.isActive({ textAlign: 'right' }))}
        title="Alinhar à direita"
      >
        <AlignRight className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
        className={btn(editor.isActive({ textAlign: 'justify' }))}
        title="Justificar"
      >
        <AlignJustify className="h-3.5 w-3.5" />
      </button>

      <div className="divider divider-horizontal mx-0.5 w-px h-5 bg-base-300" />

      {/* Horizontal rule */}
      <button
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className="btn btn-ghost btn-xs btn-square"
        title="Linha horizontal"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Undo / Redo */}
      <button
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        className="btn btn-ghost btn-xs btn-square disabled:opacity-30"
        title="Desfazer"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        className="btn btn-ghost btn-xs btn-square disabled:opacity-30"
        title="Refazer"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
