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
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Search,
  Globe,
  Upload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { WebsiteImagePickerDialog } from "./WebsiteImagePickerDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

interface MediaAsset {
  id: string;
  title: string;
  leadImageUrl?: string | null;
  fileUrl?: string | null;
  url?: string | null;
}

interface BrandAsset {
  id: string;
  name: string;
  fileUrl?: string | null;
  url?: string | null;
}

interface MediaPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onInsert: (url: string) => void;
}

function MediaPickerDialog({ open, onClose, onInsert }: MediaPickerDialogProps) {
  const [tab, setTab] = useState<"library" | "url" | "upload">("library");
  const [librarySection, setLibrarySection] = useState<"content" | "brand">("content");
  const [search, setSearch] = useState("");
  const [manualUrl, setManualUrl] = useState("");

  // Upload tab state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadAlt, setUploadAlt] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ url: string; source: "website" | "local" } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadFile(f);
    setUploadResult(null);
    setUploadError(null);
    setUploadAlt(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    const reader = new FileReader();
    reader.onload = (ev) => setUploadPreview(ev.target?.result as string ?? null);
    reader.readAsDataURL(f);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("altText", uploadAlt);
      const r = await fetch("/api/integrations/website/upload-media", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Upload failed");
      setUploadResult({ url: data.url, source: data.source });
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleInsertUploaded = () => {
    if (!uploadResult) return;
    onInsert(uploadResult.url);
    onClose();
  };

  const { data: assets = [], isLoading } = useQuery<MediaAsset[]>({
    queryKey: ["/api/content-assets"],
    queryFn: async () => {
      const r = await fetch("/api/content-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: open,
  });

  const { data: brandAssets = [], isLoading: isBrandLoading } = useQuery<BrandAsset[]>({
    queryKey: ["/api/brand-assets"],
    queryFn: async () => {
      const r = await fetch("/api/brand-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: open,
  });

  const imageAssets = assets.filter((a) => {
    const hasImage = !!(a.leadImageUrl || a.fileUrl);
    if (!hasImage) return false;
    if (!search) return true;
    return (a.title ?? "").toLowerCase().includes(search.toLowerCase());
  });

  const imageBrandAssets = brandAssets.filter((a) => {
    const hasImage = !!(a.fileUrl || a.url);
    if (!hasImage) return false;
    if (!search) return true;
    return (a.name ?? "").toLowerCase().includes(search.toLowerCase());
  });

  const handlePickAsset = (asset: MediaAsset) => {
    const url = asset.leadImageUrl || asset.fileUrl || "";
    if (url) {
      onInsert(url);
      onClose();
    }
  };

  const handlePickBrandAsset = (asset: BrandAsset) => {
    const url = asset.fileUrl || asset.url || "";
    if (url) {
      onInsert(url);
      onClose();
    }
  };

  const handleInsertUrl = () => {
    const trimmed = manualUrl.trim();
    if (!trimmed) return;
    onInsert(trimmed);
    onClose();
  };

  const handleClose = () => {
    setSearch("");
    setManualUrl("");
    setTab("library");
    setLibrarySection("content");
    setUploadFile(null);
    setUploadPreview(null);
    setUploadAlt("");
    setUploadResult(null);
    setUploadError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Insert Image</DialogTitle>
          <DialogDescription>
            Pick an image from your asset library or enter a URL directly.
          </DialogDescription>
        </DialogHeader>

        {/* Tab toggle */}
        <div className="flex rounded-md border overflow-hidden shrink-0" data-testid="media-picker-tab-toggle">
          <button
            type="button"
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              tab === "library"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("library")}
            data-testid="button-media-picker-tab-library"
          >
            Asset Library
          </button>
          <button
            type="button"
            className={`flex-1 py-1.5 text-xs font-medium transition-colors border-l ${
              tab === "upload"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("upload")}
            data-testid="button-media-picker-tab-upload"
          >
            Upload
          </button>
          <button
            type="button"
            className={`flex-1 py-1.5 text-xs font-medium transition-colors border-l ${
              tab === "url"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("url")}
            data-testid="button-media-picker-tab-url"
          >
            Enter URL
          </button>
        </div>

        {/* Library tab */}
        {tab === "library" && (
          <div className="flex flex-col gap-3 overflow-hidden min-h-0">
            {/* Library sub-tabs */}
            <div className="flex gap-1 shrink-0" data-testid="media-picker-library-subtabs">
              <button
                type="button"
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  librarySection === "content"
                    ? "bg-primary/10 border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => { setLibrarySection("content"); setSearch(""); }}
                data-testid="button-media-picker-section-content"
              >
                Content Assets
              </button>
              <button
                type="button"
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  librarySection === "brand"
                    ? "bg-primary/10 border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => { setLibrarySection("brand"); setSearch(""); }}
                data-testid="button-media-picker-section-brand"
              >
                Brand Library
              </button>
            </div>

            <div className="relative shrink-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search images…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="input-media-picker-search"
              />
            </div>

            {/* Content Assets section */}
            {librarySection === "content" && (
              <div className="overflow-y-auto flex-1 min-h-0">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
                ) : imageAssets.length === 0 ? (
                  <div className="text-center py-8 space-y-1">
                    <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      {search ? "No matching images found." : "No images found in your content library."}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Try Brand Library or use the &quot;Enter URL&quot; tab.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 pb-1">
                    {imageAssets.map((asset) => {
                      const imgUrl = asset.leadImageUrl || asset.fileUrl || "";
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          className="group border rounded-lg overflow-hidden hover:border-primary transition-colors text-left"
                          onClick={() => handlePickAsset(asset)}
                          title={asset.title}
                          data-testid={`button-media-asset-${asset.id}`}
                        >
                          <div className="aspect-video bg-muted overflow-hidden">
                            <img
                              src={imgUrl}
                              alt={asset.title}
                              className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                              loading="lazy"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate px-1.5 py-1 leading-tight">
                            {asset.title}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Brand Library section */}
            {librarySection === "brand" && (
              <div className="overflow-y-auto flex-1 min-h-0">
                {isBrandLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
                ) : imageBrandAssets.length === 0 ? (
                  <div className="text-center py-8 space-y-1">
                    <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      {search ? "No matching brand images found." : "No images found in your brand library."}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Try Content Assets or use the &quot;Enter URL&quot; tab.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 pb-1">
                    {imageBrandAssets.map((asset) => {
                      const imgUrl = asset.fileUrl || asset.url || "";
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          className="group border rounded-lg overflow-hidden hover:border-primary transition-colors text-left"
                          onClick={() => handlePickBrandAsset(asset)}
                          title={asset.name}
                          data-testid={`button-brand-asset-${asset.id}`}
                        >
                          <div className="aspect-video bg-muted overflow-hidden">
                            <img
                              src={imgUrl}
                              alt={asset.name}
                              className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                              loading="lazy"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate px-1.5 py-1 leading-tight">
                            {asset.name}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Upload tab */}
        {tab === "upload" && (
          <div className="space-y-3">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-media-picker-file"
            />

            {!uploadFile ? (
              <button
                type="button"
                className="w-full border-2 border-dashed rounded-lg py-10 flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-media-picker-drop-zone"
              >
                <Upload className="h-8 w-8" />
                <span className="text-sm font-medium">Click to choose an image</span>
                <span className="text-xs">PNG, JPG, WebP — max 10 MB</span>
              </button>
            ) : (
              <div className="space-y-3">
                {/* Preview */}
                {uploadPreview && (
                  <div className="rounded-lg overflow-hidden border aspect-video bg-muted">
                    <img
                      src={uploadPreview}
                      alt="Preview"
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}

                {/* Alt text */}
                <div className="space-y-1">
                  <Label htmlFor="upload-alt-input" className="text-xs font-medium">Alt text</Label>
                  <Input
                    id="upload-alt-input"
                    value={uploadAlt}
                    onChange={(e) => setUploadAlt(e.target.value)}
                    placeholder="Describe the image…"
                    className="text-sm"
                    data-testid="input-media-picker-alt"
                  />
                </div>

                {/* Success / error feedback */}
                {uploadResult && (
                  <div className="flex items-start gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Saved to Orbit media storage. Ready to insert.</span>
                  </div>
                )}
                {uploadError && (
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-none"
                    onClick={() => { setUploadFile(null); setUploadPreview(null); setUploadResult(null); setUploadError(null); fileInputRef.current && (fileInputRef.current.value = ""); }}
                    data-testid="button-media-picker-upload-clear"
                  >
                    Change
                  </Button>
                  {!uploadResult ? (
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1"
                      onClick={handleUpload}
                      disabled={isUploading}
                      data-testid="button-media-picker-upload-submit"
                    >
                      {isUploading ? "Uploading…" : "Upload"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1"
                      onClick={handleInsertUploaded}
                      data-testid="button-media-picker-upload-insert"
                    >
                      Insert Image
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* URL tab */}
        {tab === "url" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="media-url-input" className="text-xs font-medium">
                Image URL
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    id="media-url-input"
                    placeholder="https://example.com/image.jpg"
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleInsertUrl(); }}
                    className="pl-8 text-sm"
                    data-testid="input-media-picker-url"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleInsertUrl}
                  disabled={!manualUrl.trim()}
                  data-testid="button-media-picker-insert-url"
                >
                  Insert
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface RichTextEditorProps {
  value: string;
  onChange: (change: { html: string; markdown: string }) => void;
  "data-testid"?: string;
}

export function RichTextEditor({ value, onChange, "data-testid": testId }: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const isSettingContent = useRef(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [websitePickerOpen, setWebsitePickerOpen] = useState(false);

  const { data: websiteStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/integrations/website/status"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/website/status", { credentials: "include" });
      return r.ok ? r.json() : { connected: false };
    },
    staleTime: 5 * 60 * 1000,
  });
  const websiteConnected = websiteStatus?.connected ?? false;

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

  const handleInsertImage = (url: string) => {
    if (!editor) return;
    editor.chain().focus().setImage({ src: url }).run();
  };

  if (!editor) return null;

  return (
    <>
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
            onClick={() => setMediaPickerOpen(true)}
            active={false}
            title="Insert image"
            data-testid="rte-image"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          {websiteConnected && (
            <ToolbarButton
              onClick={() => setWebsitePickerOpen(true)}
              active={false}
              title="Browse website images"
              data-testid="rte-website-image"
            >
              <Globe className="h-3.5 w-3.5" />
            </ToolbarButton>
          )}

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

      <MediaPickerDialog
        open={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        onInsert={handleInsertImage}
      />
      <WebsiteImagePickerDialog
        open={websitePickerOpen}
        onOpenChange={setWebsitePickerOpen}
        onSelect={(item) => {
          const url = item.optimizedUrl || item.publicUrl;
          handleInsertImage(url);
        }}
      />
    </>
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
