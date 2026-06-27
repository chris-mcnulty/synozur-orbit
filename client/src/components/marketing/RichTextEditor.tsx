import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Typography from "@tiptap/extension-typography";
import TurndownService from "turndown";
import { useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Code2,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
} from "lucide-react";

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

interface RichTextEditorProps {
  value: string;
  onChange: (change: { html: string; markdown: string }) => void;
  "data-testid"?: string;
}

export function RichTextEditor({ value, onChange, "data-testid": testId }: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const isSettingContent = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Typography,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      const html = editor.getHTML();
      const markdown = td.turndown(html);
      onChangeRef.current({ html, markdown });
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== value) {
      isSettingContent.current = true;
      editor.commands.setContent(value);
      isSettingContent.current = false;
    }
  }, [value, editor]);

  const addLink = () => {
    if (!editor) return;
    const url = window.prompt("Enter link URL:");
    if (!url) return;
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent(`<a href="${url}">${url}</a>`).run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const addImage = () => {
    if (!editor) return;
    const url = window.prompt("Enter image URL:");
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  };

  if (!editor) return null;

  return (
    <div className="rounded-md border border-input bg-background overflow-hidden" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input px-1.5 py-1 bg-muted/30">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold"
          data-testid="rte-bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic"
          data-testid="rte-italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          title="Heading 1"
          data-testid="rte-h1"
        >
          <Heading1 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
          data-testid="rte-h2"
        >
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
          data-testid="rte-h3"
        >
          <Heading3 className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
          data-testid="rte-bullet-list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Ordered list"
          data-testid="rte-ordered-list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="Blockquote"
          data-testid="rte-blockquote"
        >
          <Quote className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive("code")}
          title="Inline code"
          data-testid="rte-code"
        >
          <Code className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive("codeBlock")}
          title="Code block"
          data-testid="rte-code-block"
        >
          <Code2 className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarButton
          onClick={addLink}
          active={editor.isActive("link")}
          title="Insert link"
          data-testid="rte-link"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={addImage}
          active={false}
          title="Insert image (URL)"
          data-testid="rte-image"
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          active={false}
          title="Undo"
          data-testid="rte-undo"
          disabled={!editor.can().undo()}
        >
          <Undo className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          active={false}
          title="Redo"
          data-testid="rte-redo"
          disabled={!editor.can().redo()}
        >
          <Redo className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>

      <EditorContent
        editor={editor}
        className="rte-content min-h-[380px] px-3 py-2 text-sm focus-within:outline-none"
      />
    </div>
  );
}

interface ToolbarButtonProps {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
  "data-testid"?: string;
  disabled?: boolean;
}

function ToolbarButton({ onClick, active, title, children, "data-testid": testId, disabled }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      data-testid={testId}
      className={`inline-flex items-center justify-center rounded p-1 transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
