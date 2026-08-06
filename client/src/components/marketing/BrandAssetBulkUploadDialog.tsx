import { useState, useRef, useCallback, useId } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, CheckCircle2, AlertCircle, Image, FileText, Type, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

interface BrandAssetCategory {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: BrandAssetCategory[];
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  logo: "Logo",
  font: "Font",
  workshop: "Workshop",
  case_study: "Case Study",
  app: "App",
  model: "Model",
  blog_post: "Blog Post",
  whitepaper: "Whitepaper",
  video: "Video",
  other: "Other",
};

type FileStatus = "queued" | "uploading" | "done" | "error";

interface FileEntry {
  id: string;
  file: File;
  name: string;
  previewUrl?: string;
  status: FileStatus;
  error?: string;
  objectPath?: string;
}

function guessAssetType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type;
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "other";
  if (["ttf", "otf", "woff", "woff2"].includes(ext) || mime.startsWith("font/")) return "font";
  if (mime.startsWith("video/") || ["mp4", "mov", "webm"].includes(ext)) return "video";
  if (["pdf", "doc", "docx"].includes(ext)) return "whitepaper";
  return "other";
}

function guessFileType(file: File): string {
  // Prefer the browser-supplied MIME type — it's what the picker uses to detect images.
  // Fall back to extension-derived strings only when the browser can't identify the type.
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const fontMimes: Record<string, string> = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };
  if (fontMimes[ext]) return fontMimes[ext];
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
  if (ext === "svg") return "image/svg+xml";
  if (["mp4", "mov", "webm"].includes(ext)) return `video/${ext}`;
  if (ext === "pdf") return "application/pdf";
  return ext || "application/octet-stream";
}

function fileBasename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

const CONCURRENCY = 3;

export default function BrandAssetBulkUploadDialog({ open, onOpenChange, categories }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [categoryId, setCategoryId] = useState<string>("none");
  const [assetType, setAssetType] = useState<string>("other");
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropZoneId = useId();

  const addFiles = useCallback((incoming: File[]) => {
    const entries: FileEntry[] = incoming.map(file => {
      const id = crypto.randomUUID();
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      return {
        id,
        file,
        name: fileBasename(file.name),
        previewUrl,
        status: "queued",
      };
    });
    setFiles(prev => {
      // Dedup by filename+size
      const existingKeys = new Set(prev.map(e => `${e.file.name}:${e.file.size}`));
      return [...prev, ...entries.filter(e => !existingKeys.has(`${e.file.name}:${e.file.size}`))];
    });
    // Auto-detect asset type from first file if all types agree
    if (incoming.length > 0) {
      const guessed = guessAssetType(incoming[0]);
      if (incoming.every(f => guessAssetType(f) === guessed)) {
        setAssetType(guessed);
      }
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) addFiles(dropped);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) addFiles(selected);
    e.target.value = "";
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const entry = prev.find(e => e.id === id);
      if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      return prev.filter(e => e.id !== id);
    });
  };

  const updateName = (id: string, name: string) => {
    setFiles(prev => prev.map(e => e.id === id ? { ...e, name } : e));
  };

  const uploadOne = async (entry: FileEntry): Promise<{ objectPath?: string; error?: string }> => {
    const file = entry.file;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isFontFile = file.type.startsWith("font/") || ["ttf", "otf", "woff", "woff2"].includes(ext);
    const fontMime: Record<string, string> = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };
    const contentType = (file.type && file.type !== "application/octet-stream")
      ? file.type
      : isFontFile ? (fontMime[ext] ?? "application/octet-stream") : "application/octet-stream";

    const reqRes = await fetch("/api/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: file.name, size: file.size, contentType }),
    });
    if (!reqRes.ok) {
      const body = await reqRes.json().catch(() => ({}));
      return { error: body.error ?? "Could not get upload URL" };
    }
    const { uploadURL, objectPath } = await reqRes.json();
    const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
    if (!putRes.ok) return { error: "File upload to storage failed" };
    return { objectPath };
  };

  const saveOne = async (entry: FileEntry, objectPath: string) => {
    const body: Record<string, unknown> = {
      name: entry.name.trim() || fileBasename(entry.file.name),
      fileUrl: objectPath,
      fileType: guessFileType(entry.file),
      assetType,
      categoryId: categoryId !== "none" ? categoryId : undefined,
    };
    const res = await fetch("/api/brand-assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.error ?? "Failed to save asset");
    }
  };

  const runUpload = async () => {
    const queued = files.filter(e => e.status === "queued");
    if (queued.length === 0) return;
    setRunning(true);

    // Mark all queued as uploading in batches
    const queue = [...queued];
    let idx = 0;

    const processOne = async (entry: FileEntry) => {
      setFiles(prev => prev.map(e => e.id === entry.id ? { ...e, status: "uploading" } : e));
      try {
        const { objectPath, error } = await uploadOne(entry);
        if (error || !objectPath) {
          setFiles(prev => prev.map(e => e.id === entry.id ? { ...e, status: "error", error: error ?? "Upload failed" } : e));
          return;
        }
        await saveOne(entry, objectPath);
        setFiles(prev => prev.map(e => e.id === entry.id ? { ...e, status: "done", objectPath } : e));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        setFiles(prev => prev.map(e => e.id === entry.id ? { ...e, status: "error", error: msg } : e));
      }
    };

    // Concurrency pool
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (idx < queue.length) {
        const entry = queue[idx++];
        await processOne(entry);
      }
    });
    await Promise.all(workers);

    setRunning(false);
    queryClient.invalidateQueries({ queryKey: ["/api/brand-assets"] });

    const done = files.filter(e => e.status === "done").length
      + queue.filter(e => e.status === "done").length;

    // Count outcomes after state update — use a callback
    setFiles(prev => {
      const successes = prev.filter(e => e.status === "done").length;
      const failures = prev.filter(e => e.status === "error").length;
      if (successes > 0) {
        toast({
          title: `${successes} asset${successes !== 1 ? "s" : ""} uploaded`,
          description: failures > 0 ? `${failures} failed — review errors below` : undefined,
        });
      } else if (failures > 0) {
        toast({ title: "Upload failed", description: "All files failed to upload.", variant: "destructive" });
      }
      return prev;
    });
  };

  const handleClose = (v: boolean) => {
    if (running) return;
    if (!v) {
      // Revoke object URLs
      files.forEach(e => { if (e.previewUrl) URL.revokeObjectURL(e.previewUrl); });
      setFiles([]);
      setCategoryId("none");
      setAssetType("other");
    }
    onOpenChange(v);
  };

  const doneCount = files.filter(e => e.status === "done").length;
  const errorCount = files.filter(e => e.status === "error").length;
  const queuedCount = files.filter(e => e.status === "queued").length;

  const allDone = files.length > 0 && files.every(e => e.status === "done" || e.status === "error");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Upload Brand Assets</DialogTitle>
          <DialogDescription>
            Drop multiple files — they all land in the same category. Edit names before uploading.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto flex-1 pr-0.5">
          {/* Shared settings row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${dropZoneId}-cat`}>Category (applies to all)</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id={`${dropZoneId}-cat`} data-testid="select-bulk-category">
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${dropZoneId}-type`}>Asset Type (applies to all)</Label>
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger id={`${dropZoneId}-type`} data-testid="select-bulk-asset-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ASSET_TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Drop zone */}
          <div
            role="button"
            aria-label="Drop files here or click to browse"
            tabIndex={0}
            onDragEnter={e => { e.preventDefault(); setDragging(true); }}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => e.key === "Enter" && inputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors select-none",
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
            )}
            data-testid="dropzone-bulk-upload"
          >
            <Upload className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm font-medium">Drop files here, or <span className="text-primary underline">browse</span></p>
            <p className="text-xs text-muted-foreground">Images, PDFs, fonts, videos — any file type</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleInputChange}
              data-testid="input-bulk-file"
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {files.length} file{files.length !== 1 ? "s" : ""}
                  {doneCount > 0 && <span className="text-green-500 ml-2">· {doneCount} done</span>}
                  {errorCount > 0 && <span className="text-destructive ml-2">· {errorCount} failed</span>}
                </p>
                {queuedCount > 0 && !running && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={() => {
                      files.forEach(e => { if (e.previewUrl) URL.revokeObjectURL(e.previewUrl); });
                      setFiles([]);
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {files.map(entry => (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                      entry.status === "done" && "border-green-500/40 bg-green-500/5",
                      entry.status === "error" && "border-destructive/40 bg-destructive/5",
                      entry.status === "uploading" && "border-primary/40 bg-primary/5",
                      entry.status === "queued" && "border-border bg-muted/20",
                    )}
                    data-testid={`bulk-file-row-${entry.id}`}
                  >
                    {/* Thumbnail or icon */}
                    <div className="w-9 h-9 rounded flex-shrink-0 overflow-hidden bg-muted flex items-center justify-center">
                      {entry.previewUrl ? (
                        <img src={entry.previewUrl} alt="" className="w-full h-full object-cover" />
                      ) : entry.file.type.startsWith("font/") || /\.(ttf|otf|woff|woff2)$/i.test(entry.file.name) ? (
                        <Type className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <FileText className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>

                    {/* Name edit */}
                    <div className="flex-1 min-w-0">
                      {entry.status === "queued" ? (
                        <Input
                          value={entry.name}
                          onChange={e => updateName(entry.id, e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Asset name"
                          data-testid={`input-bulk-name-${entry.id}`}
                        />
                      ) : (
                        <p className="text-xs font-medium truncate">{entry.name || entry.file.name}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{entry.file.name}</p>
                      {entry.error && <p className="text-[10px] text-destructive mt-0.5">{entry.error}</p>}
                    </div>

                    {/* Status indicator / remove */}
                    <div className="flex-shrink-0">
                      {entry.status === "uploading" && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                      {entry.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      {entry.status === "error" && <AlertCircle className="w-4 h-4 text-destructive" />}
                      {entry.status === "queued" && (
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => removeFile(entry.id)}
                          aria-label="Remove file"
                          data-testid={`button-bulk-remove-${entry.id}`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t mt-2">
          {allDone ? (
            <p className="text-sm text-muted-foreground">
              {doneCount > 0 ? `${doneCount} asset${doneCount !== 1 ? "s" : ""} added to library` : "Upload complete"}
              {errorCount > 0 && ` · ${errorCount} failed`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {files.length === 0 ? "No files selected" : `${queuedCount} ready to upload`}
            </p>
          )}
          <div className="flex gap-2">
            {allDone ? (
              <Button onClick={() => handleClose(false)} data-testid="button-bulk-done">Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => handleClose(false)} disabled={running}>
                  Cancel
                </Button>
                <Button
                  onClick={runUpload}
                  disabled={queuedCount === 0 || running}
                  data-testid="button-bulk-upload-start"
                >
                  {running ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading…</>
                  ) : (
                    <><Upload className="w-4 h-4 mr-2" />Upload {queuedCount > 0 ? queuedCount : ""} file{queuedCount !== 1 ? "s" : ""}</>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
