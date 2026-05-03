import React, { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Upload,
  Download,
  Archive,
  ArchiveRestore,
  Trash2,
  MoreHorizontal,
  Loader2,
  AlertTriangle,
  Pencil,
  Lock,
  Eye,
  Sparkles,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface CompetitorDocument {
  id: string;
  fileName: string;
  displayTitle: string;
  scopeTag: string | null;
  fileType: string;
  mimeType: string;
  byteSize: number;
  status: "active" | "archived";
  uploadedAt: string;
  uploadedByName?: string;
  hasExtractedText?: boolean;
}

interface DocumentSource {
  id: string;
  competitorId: string;
  displayTitle: string;
  scopeTag: string | null;
}

interface DocumentPreview {
  id: string;
  displayTitle: string;
  scopeTag: string | null;
  fileType: string;
  byteSize: number;
  uploadedAt: string;
  extractedText: string | null;
  extractedTextTruncated: boolean;
}

const SCOPE_SUGGESTIONS = [
  "positioning",
  "pricing",
  "case-study",
  "datasheet",
  "annual-report",
  "press-release",
  "product-launch",
  "competitive-intel",
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface Props {
  competitorId: string;
  competitorName: string;
  featureEnabled: boolean;
  latestSources?: DocumentSource[];
}

export default function CompetitorDocuments({
  competitorId,
  competitorName,
  featureEnabled,
  latestSources = [],
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [displayTitle, setDisplayTitle] = useState("");
  const [scopeTag, setScopeTag] = useState<string>("");
  const [uploading, setUploading] = useState(false);

  const [editDoc, setEditDoc] = useState<CompetitorDocument | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editScope, setEditScope] = useState("");

  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const queryKey = [`/api/competitors/${competitorId}/documents`, { showArchived }];

  const { data: docs = [], isLoading } = useQuery<CompetitorDocument[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/competitors/${competitorId}/documents?includeArchived=${showArchived}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
  });

  const { data: previewData, isLoading: previewLoading } = useQuery<DocumentPreview>({
    queryKey: [`/api/competitors/${competitorId}/documents/${previewDocId}/preview`],
    queryFn: async () => {
      const res = await fetch(
        `/api/competitors/${competitorId}/documents/${previewDocId}/preview`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load preview");
      return res.json();
    },
    enabled: !!previewDocId,
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "archived" }) => {
      const res = await fetch(`/api/competitors/${competitorId}/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/competitors/${competitorId}/documents`] }),
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, displayTitle, scopeTag }: { id: string; displayTitle?: string; scopeTag?: string | null }) => {
      const res = await fetch(`/api/competitors/${competitorId}/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ displayTitle, scopeTag }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/competitors/${competitorId}/documents`] });
      setEditDoc(null);
      toast({ title: "Document updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, hard }: { id: string; hard?: boolean }) => {
      const res = await fetch(
        `/api/competitors/${competitorId}/documents/${id}${hard ? "?hard=true" : ""}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [`/api/competitors/${competitorId}/documents`] });
      toast({ title: data?.hardDeleted ? "Document permanently deleted" : "Document archived" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  function pickFile() {
    fileInputRef.current?.click();
  }

  function startUploadFlowFor(file: File) {
    setPendingFile(file);
    setDisplayTitle(file.name.replace(/\.[^.]+$/, ""));
    setScopeTag("");
    setUploadOpen(true);
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    startUploadFlowFor(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (!featureEnabled) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ok = /\.(pdf|docx|doc|txt)$/i.test(file.name);
    if (!ok) {
      toast({
        title: "Unsupported file type",
        description: "Only PDF, DOCX, DOC, or TXT files can be uploaded.",
        variant: "destructive",
      });
      return;
    }
    startUploadFlowFor(file);
  }

  async function performUpload() {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", pendingFile);
      fd.append("displayTitle", displayTitle.trim() || pendingFile.name);
      if (scopeTag.trim()) fd.append("scopeTag", scopeTag.trim());
      const res = await fetch(`/api/competitors/${competitorId}/documents`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      toast({
        title: "Document uploaded",
        description: `"${displayTitle}" is now grounding ${competitorName}'s analyses, battlecards, and briefings.`,
      });
      setUploadOpen(false);
      setPendingFile(null);
      qc.invalidateQueries({ queryKey: [`/api/competitors/${competitorId}/documents`] });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  const sourcesForThisCompetitor = latestSources.filter((s) => s.competitorId === competitorId);

  return (
    <div className="space-y-6">
      {sourcesForThisCompetitor.length > 0 && (
        <Card data-testid="card-sources-used">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              AI sources used in latest analysis
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These uploaded documents grounded the most recent AI analysis for {competitorName}.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {sourcesForThisCompetitor.map((s) => (
                <button
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950"
                  onClick={() => setPreviewDocId(s.id)}
                  data-testid={`source-chip-${s.id}`}
                  title="Preview source"
                >
                  <FileText className="h-3 w-3" />
                  <span className="font-medium">{s.displayTitle}</span>
                  {s.scopeTag && (
                    <Badge variant="secondary" className="text-[10px] py-0">{s.scopeTag}</Badge>
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Competitor Documents</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Upload PDF, DOCX, or TXT files (datasheets, case studies, annual reports). Their text grounds AI analyses, battlecards, and briefings for {competitorName}.
            </p>
            {!featureEnabled && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Upgrade to Pro or higher to upload new documents. Existing documents remain visible in read-only mode.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchived((s) => !s)}
              data-testid="button-toggle-archived"
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
            <Button
              onClick={pickFile}
              disabled={!featureEnabled}
              data-testid="button-upload-document"
              title={featureEnabled ? "Upload a new document" : "Upgrade plan to upload documents"}
            >
              <Upload className="h-4 w-4 mr-2" /> Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="hidden"
              onChange={onFileSelected}
              data-testid="input-document-file"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (featureEnabled) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`mb-4 rounded-lg border-2 border-dashed p-6 text-center text-sm transition ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/20 text-muted-foreground"
            } ${!featureEnabled ? "opacity-60" : ""}`}
            data-testid="dropzone-document"
          >
            <Upload className="h-5 w-5 mx-auto mb-1 opacity-70" />
            {featureEnabled ? (
              <>
                Drag &amp; drop a PDF, DOCX, or TXT here, or{" "}
                <button
                  type="button"
                  className="underline font-medium"
                  onClick={pickFile}
                  data-testid="link-pick-file"
                >
                  choose a file
                </button>
                . Max 10MB.
              </>
            ) : (
              <>Upgrade your plan to upload competitor documents.</>
            )}
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : docs.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No documents uploaded yet.</p>
              {!featureEnabled && (
                <p className="text-xs mt-1">Upgrade your plan to start grounding AI with first-party documents.</p>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {docs.map((doc) => {
                const wasUsedAsSource = sourcesForThisCompetitor.some((s) => s.id === doc.id);
                return (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between py-3"
                    data-testid={`row-document-${doc.id}`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            className="font-medium truncate hover:underline text-left"
                            onClick={() => setPreviewDocId(doc.id)}
                            data-testid={`text-document-title-${doc.id}`}
                          >
                            {doc.displayTitle}
                          </button>
                          {doc.scopeTag && (
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-scope-${doc.id}`}>
                              {doc.scopeTag}
                            </Badge>
                          )}
                          {doc.status === "archived" && (
                            <Badge variant="outline" className="text-xs">Archived</Badge>
                          )}
                          {!doc.hasExtractedText && doc.status === "active" && (
                            <Badge
                              variant="outline"
                              className="text-xs text-amber-600 border-amber-300"
                              data-testid={`badge-extracting-${doc.id}`}
                            >
                              Extracting…
                            </Badge>
                          )}
                          {wasUsedAsSource && (
                            <Badge
                              variant="outline"
                              className="text-xs text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950"
                              data-testid={`badge-used-${doc.id}`}
                            >
                              <Sparkles className="h-3 w-3 mr-1" /> Used by AI
                            </Badge>
                          )}
                        </div>
                        <p
                          className="text-xs text-muted-foreground mt-0.5"
                          data-testid={`text-doc-meta-${doc.id}`}
                        >
                          {doc.fileType.toUpperCase()} · {formatBytes(doc.byteSize)} · uploaded{" "}
                          {formatDistanceToNow(new Date(doc.uploadedAt), { addSuffix: true })}
                          {doc.uploadedByName ? ` by ${doc.uploadedByName}` : ""}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-document-menu-${doc.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setPreviewDocId(doc.id)}
                          data-testid={`menu-preview-${doc.id}`}
                        >
                          <Eye className="h-4 w-4 mr-2" /> Preview
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            window.open(
                              `/api/competitors/${competitorId}/documents/${doc.id}/download`,
                              "_blank",
                            );
                          }}
                          data-testid={`menu-download-${doc.id}`}
                        >
                          <Download className="h-4 w-4 mr-2" /> Download
                        </DropdownMenuItem>
                        {featureEnabled && (
                          <DropdownMenuItem
                            onClick={() => {
                              setEditDoc(doc);
                              setEditTitle(doc.displayTitle);
                              setEditScope(doc.scopeTag || "");
                            }}
                            data-testid={`menu-edit-${doc.id}`}
                          >
                            <Pencil className="h-4 w-4 mr-2" /> Edit details
                          </DropdownMenuItem>
                        )}
                        {featureEnabled && (
                          doc.status === "active" ? (
                            <DropdownMenuItem
                              onClick={() => archiveMutation.mutate({ id: doc.id, status: "archived" })}
                              data-testid={`menu-archive-${doc.id}`}
                            >
                              <Archive className="h-4 w-4 mr-2" /> Archive
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => archiveMutation.mutate({ id: doc.id, status: "active" })}
                              data-testid={`menu-restore-${doc.id}`}
                            >
                              <ArchiveRestore className="h-4 w-4 mr-2" /> Restore
                            </DropdownMenuItem>
                          )
                        )}
                        {featureEnabled && (
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              if (
                                confirm(
                                  `Permanently delete "${doc.displayTitle}"? This removes the file from storage and cannot be undone. Use Archive to keep the file but stop grounding AI.`,
                                )
                              ) {
                                deleteMutation.mutate({ id: doc.id, hard: true });
                              }
                            }}
                            data-testid={`menu-delete-${doc.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete permanently
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload competitor document</DialogTitle>
            <DialogDescription>
              {pendingFile ? `${pendingFile.name} · ${formatBytes(pendingFile.size)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="doc-title">Display title</Label>
              <Input
                id="doc-title"
                value={displayTitle}
                onChange={(e) => setDisplayTitle(e.target.value)}
                data-testid="input-document-display-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-scope">Scope tag (optional)</Label>
              <Input
                id="doc-scope"
                list="doc-scope-suggestions"
                value={scopeTag}
                onChange={(e) => setScopeTag(e.target.value)}
                placeholder="e.g. pricing, case-study, q4-roadmap"
                data-testid="input-document-scope"
              />
              <datalist id="doc-scope-suggestions">
                {SCOPE_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Free-text label that helps the AI categorize this document. Suggestions provided.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={performUpload} disabled={uploading} data-testid="button-confirm-upload">
              {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editDoc} onOpenChange={(open) => !open && setEditDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit document details</DialogTitle>
            <DialogDescription>
              Rename or change the scope tag. The underlying file is unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-doc-title">Display title</Label>
              <Input
                id="edit-doc-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                data-testid="input-edit-document-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-doc-scope">Scope tag</Label>
              <Input
                id="edit-doc-scope"
                list="doc-scope-suggestions"
                value={editScope}
                onChange={(e) => setEditScope(e.target.value)}
                placeholder="e.g. pricing, case-study"
                data-testid="input-edit-document-scope"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDoc(null)} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editDoc) return;
                updateMutation.mutate({
                  id: editDoc.id,
                  displayTitle: editTitle.trim() || editDoc.displayTitle,
                  scopeTag: editScope.trim() ? editScope.trim() : null,
                });
              }}
              disabled={updateMutation.isPending}
              data-testid="button-confirm-edit"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!previewDocId} onOpenChange={(open) => !open && setPreviewDocId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {previewData?.displayTitle || "Preview"}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2 text-xs">
              {previewData ? (
                <>
                  <span>
                    {previewData.fileType.toUpperCase()} · {formatBytes(previewData.byteSize)} · uploaded{" "}
                    {formatDistanceToNow(new Date(previewData.uploadedAt), { addSuffix: true })}
                  </span>
                  {previewData.scopeTag && <Badge variant="secondary" className="text-[10px]">{previewData.scopeTag}</Badge>}
                </>
              ) : (
                "Loading…"
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden flex flex-col" data-testid="text-document-preview">
            {previewLoading ? (
              <div className="text-center py-10">
                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
              </div>
            ) : previewData?.fileType === "pdf" && previewDocId ? (
              <iframe
                title={previewData.displayTitle}
                src={`/api/competitors/${competitorId}/documents/${previewDocId}/inline#toolbar=0&navpanes=0`}
                className="flex-1 w-full rounded-md border"
                data-testid="iframe-pdf-preview"
              />
            ) : previewData?.extractedText ? (
              <div className="flex-1 overflow-y-auto rounded-md bg-muted/40 p-4 text-sm font-mono whitespace-pre-wrap">
                {previewData.extractedText}
                {previewData.extractedTextTruncated && (
                  <p className="mt-4 text-xs text-amber-600 not-italic">
                    Preview truncated. Download the original file to view the complete document.
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
                Text extraction has not completed yet, or the file contained no extractable text.
                Use Download to view the original.
              </div>
            )}
          </div>
          <DialogFooter className="flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                if (!previewDocId) return;
                window.open(
                  `/api/competitors/${competitorId}/documents/${previewDocId}/download`,
                  "_blank",
                );
              }}
            >
              <Download className="h-4 w-4 mr-2" /> Download original
            </Button>
            <Button onClick={() => setPreviewDocId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
