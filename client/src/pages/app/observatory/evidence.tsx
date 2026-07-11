import { useRef, useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/lib/userContext";
import { useSearch, useLocation } from "wouter";
import { Archive, Download, FileText, Loader2, Paperclip, Pencil, Plus, Search, ExternalLink, X } from "lucide-react";
import { EVIDENCE_TYPES, labelFor } from "./shared";
import { formatDate } from "@/lib/utils";

interface EvidenceRow {
  id: string;
  title: string;
  description: string | null;
  evidenceType: string;
  source: string | null;
  externalUrl: string | null;
  hasFile: boolean;
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  collectedAt: string | null;
  createdAt: string;
}

const ALLOWED_MIME_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(contentType: string | null): boolean {
  return !!contentType && contentType.startsWith("image/");
}

const MIME_LABELS: Record<string, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/gif": "GIF",
  "image/webp": "WebP",
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/msword": "DOC",
  "text/plain": "TXT",
};

function mimeLabel(contentType: string | null): string | null {
  if (!contentType) return null;
  return MIME_LABELS[contentType] ?? contentType.split("/")[1]?.toUpperCase() ?? null;
}

export default function ObservatoryEvidence() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const linkFindingId = params.get("findingId") ?? "";
  const linkAssessmentId = params.get("assessmentId") ?? "";
  const canWrite = ["Analyst", "Domain Admin", "Global Admin"].includes(user?.role ?? "");

  const [typeFilter, setTypeFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  // ── Create dialog ──────────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(!!linkFindingId || !!linkAssessmentId);
  const [form, setForm] = useState({
    title: "", description: "", evidenceType: "screenshot",
    sourceTool: "", externalUrl: "", collectedAt: "",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Edit dialog ────────────────────────────────────────────────────────────
  const [editingEvidence, setEditingEvidence] = useState<EvidenceRow | null>(null);
  const [editForm, setEditForm] = useState({
    title: "", description: "", evidenceType: "screenshot",
    sourceTool: "", externalUrl: "", collectedAt: "",
  });
  // null = keep existing; File = replace with new upload
  const [editSelectedFile, setEditSelectedFile] = useState<File | null>(null);
  const [editUploadError, setEditUploadError] = useState<string | null>(null);
  // true = user clicked "Remove file" (clear existing attachment)
  const [editRemoveFile, setEditRemoveFile] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const qp = new URLSearchParams();
  if (typeFilter !== "all") qp.set("type", typeFilter);
  if (searchTerm.trim()) qp.set("search", searchTerm.trim());
  const qs = qp.toString();

  const { data: evidence, isLoading } = useQuery<EvidenceRow[]>({
    queryKey: [`/api/observatory/evidence${qs ? `?${qs}` : ""}`],
  });

  // ── File validation helpers ───────────────────────────────────────────────
  function validateFile(file: File): string | null {
    if (!ALLOWED_MIME_TYPES.includes(file.type))
      return "File type not supported. Use images (JPEG, PNG, GIF, WebP), PDF, DOCX, DOC, or TXT.";
    if (file.size > MAX_FILE_SIZE)
      return `File is too large (max ${formatBytes(MAX_FILE_SIZE)}).`;
    return null;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) { setSelectedFile(null); return; }
    const err = validateFile(file);
    if (err) {
      setUploadError(err);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSelectedFile(file);
  }

  function clearFile() {
    setSelectedFile(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleEditFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEditUploadError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) { setEditSelectedFile(null); return; }
    const err = validateFile(file);
    if (err) {
      setEditUploadError(err);
      setEditSelectedFile(null);
      if (editFileInputRef.current) editFileInputRef.current.value = "";
      return;
    }
    setEditSelectedFile(file);
    setEditRemoveFile(false);
  }

  function clearEditFile() {
    setEditSelectedFile(null);
    setEditUploadError(null);
    if (editFileInputRef.current) editFileInputRef.current.value = "";
  }

  // ── Upload helper ─────────────────────────────────────────────────────────
  async function uploadFile(file: File): Promise<{ fileUrl: string; fileName: string; fileSize: number; contentType: string }> {
    const { uploadURL, objectPath } = await (
      await apiRequest("POST", "/api/uploads/request-url", {
        name: file.name,
        size: file.size,
        contentType: file.type,
      })
    ).json();

    const putRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!putRes.ok) throw new Error("File upload failed. Please try again.");

    return {
      fileUrl: objectPath,
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type,
    };
  }

  // ── Create mutation ───────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      let fileMeta: { fileUrl: string; fileName: string; fileSize: number; contentType: string } | null = null;
      if (selectedFile) {
        fileMeta = await uploadFile(selectedFile);
      }
      return (
        await apiRequest("POST", "/api/observatory/evidence", {
          title: form.title,
          description: form.description || null,
          evidenceType: form.evidenceType,
          source: form.sourceTool || null,
          externalUrl: form.externalUrl || null,
          collectedAt: form.collectedAt || null,
          ...(fileMeta ?? {}),
          ...(linkFindingId ? { linkFindingId } : {}),
          ...(linkAssessmentId ? { linkAssessmentId } : {}),
        })
      ).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });
      setDialogOpen(false);
      setForm({ title: "", description: "", evidenceType: "screenshot", sourceTool: "", externalUrl: "", collectedAt: "" });
      setSelectedFile(null);
      setUploadError(null);
      toast({
        title: "Evidence added",
        description: linkFindingId ? "Linked to the finding." : linkAssessmentId ? "Linked to the assessment." : undefined,
      });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // ── Edit mutation ─────────────────────────────────────────────────────────
  const patchMutation = useMutation({
    mutationFn: async () => {
      if (!editingEvidence) return;
      let filePatch: Record<string, unknown> = {};

      if (editSelectedFile) {
        // Upload the new file and replace metadata
        const meta = await uploadFile(editSelectedFile);
        filePatch = meta;
      } else if (editRemoveFile) {
        // Explicitly clear the attachment
        filePatch = { fileUrl: null, fileName: null, fileSize: null, contentType: null };
      }

      return (
        await apiRequest("PATCH", `/api/observatory/evidence/${editingEvidence.id}`, {
          title: editForm.title,
          description: editForm.description || null,
          evidenceType: editForm.evidenceType,
          source: editForm.sourceTool || null,
          externalUrl: editForm.externalUrl || null,
          collectedAt: editForm.collectedAt || null,
          ...filePatch,
        })
      ).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/observatory") });
      setEditingEvidence(null);
      toast({ title: "Evidence updated" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  function openEditDialog(ev: EvidenceRow) {
    setEditingEvidence(ev);
    setEditForm({
      title: ev.title,
      description: ev.description ?? "",
      evidenceType: ev.evidenceType,
      sourceTool: ev.source ?? "",
      externalUrl: ev.externalUrl ?? "",
      collectedAt: ev.collectedAt ? ev.collectedAt.split("T")[0] : "",
    });
    setEditSelectedFile(null);
    setEditUploadError(null);
    setEditRemoveFile(false);
  }

  // Resolve the "current" file state while the edit dialog is open
  const editCurrentFile: { name: string; size: number | null; type: string | null; url: string } | null =
    editingEvidence && editingEvidence.fileUrl && !editRemoveFile && !editSelectedFile
      ? { name: editingEvidence.fileName ?? "Attached file", size: editingEvidence.fileSize, type: editingEvidence.contentType, url: editingEvidence.fileUrl }
      : null;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-evidence-title">Evidence Vault</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Screenshots, scan reports, attestations, and documents that back your assessments and findings.
            </p>
          </div>
          {canWrite && (
            <Button onClick={() => setDialogOpen(true)} data-testid="button-new-evidence">
              <Plus className="h-4 w-4 mr-2" /> Add Evidence
            </Button>
          )}
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 w-[240px]" placeholder="Search evidence…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="input-search-evidence" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[170px]" data-testid="select-filter-evidence-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {EVIDENCE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (evidence ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-3">
              <Archive className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">The vault is empty</p>
              <p className="text-sm text-muted-foreground">Add evidence here, or from a finding or assessment to link it automatically.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(evidence ?? []).map((e) => (
              <Card
                key={e.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                data-testid={`card-evidence-${e.id}`}
                onClick={() => navigate(`/app/observatory/evidence/${e.id}`)}
              >
                <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate" data-testid={`text-evidence-title-${e.id}`}>{e.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {e.source ? `${e.source} · ` : ""}
                      {e.fileName ? e.fileName : (e.description ?? "")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {e.hasFile && (
                      <a
                        href={`/api/observatory/evidence/${e.id}/file`}
                        download={e.fileName ?? undefined}
                        className="text-muted-foreground hover:text-foreground"
                        title={e.fileName ? `Download ${e.fileName}` : "Download file"}
                        onClick={(ev) => ev.stopPropagation()}
                        data-testid={`link-evidence-download-${e.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                    {e.externalUrl && (
                      <a href={e.externalUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" onClick={(ev) => ev.stopPropagation()} data-testid={`link-evidence-url-${e.id}`}>
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDate(e.collectedAt ?? e.createdAt)}</span>
                    <Badge variant="secondary" className="text-xs">{labelFor(EVIDENCE_TYPES, e.evidenceType)}</Badge>
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => openEditDialog(e)}
                        data-testid={`button-edit-evidence-${e.id}`}
                        aria-label="Edit evidence"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Add evidence dialog ─────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!createMutation.isPending) {
          setDialogOpen(open);
          if (!open) { setSelectedFile(null); setUploadError(null); }
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Evidence</DialogTitle>
            <DialogDescription>
              {linkFindingId
                ? "This evidence will be linked to the finding you came from."
                : linkAssessmentId
                  ? "This evidence will be linked to the assessment you came from."
                  : "Add an item to the evidence vault."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-evidence-title" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={form.evidenceType} onValueChange={(v) => setForm({ ...form, evidenceType: v })}>
                  <SelectTrigger data-testid="select-evidence-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Collected on</Label>
                <Input type="date" value={form.collectedAt} onChange={(e) => setForm({ ...form, collectedAt: e.target.value })} data-testid="input-evidence-collected" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source tool</Label>
                <Input placeholder="e.g. axe DevTools, Burp Suite" value={form.sourceTool} onChange={(e) => setForm({ ...form, sourceTool: e.target.value })} data-testid="input-evidence-source" />
              </div>
              <div className="space-y-2">
                <Label>External URL</Label>
                <Input placeholder="https://…" value={form.externalUrl} onChange={(e) => setForm({ ...form, externalUrl: e.target.value })} data-testid="input-evidence-url" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Attach file</Label>
              {selectedFile ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate flex-1">{selectedFile.name}</span>
                  <span className="text-muted-foreground shrink-0">{formatBytes(selectedFile.size)}</span>
                  <button type="button" onClick={clearFile} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Remove file" data-testid="button-remove-file">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div
                  className="flex items-center gap-2 rounded-md border border-dashed px-3 py-3 cursor-pointer hover:border-foreground/40 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="dropzone-evidence-file"
                >
                  <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground">
                    Click to attach a screenshot, PDF, or scan report (max 10 MB)
                  </span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_MIME_TYPES.join(",")}
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-evidence-file"
              />
              {uploadError && (
                <p className="text-xs text-destructive" data-testid="text-evidence-file-error">{uploadError}</p>
              )}
              <p className="text-xs text-muted-foreground">Supports JPEG, PNG, GIF, WebP, PDF, DOCX, DOC, TXT. Optional — evidence without a file still works.</p>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-evidence-description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={createMutation.isPending} data-testid="button-cancel-evidence">Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending || !!uploadError} data-testid="button-save-evidence">
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {selectedFile ? "Uploading…" : "Saving…"}
                </>
              ) : "Add evidence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit evidence dialog ────────────────────────────────────────────── */}
      <Dialog open={!!editingEvidence} onOpenChange={(open) => {
        if (!patchMutation.isPending && !open) {
          setEditingEvidence(null);
          clearEditFile();
          setEditRemoveFile(false);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Evidence</DialogTitle>
            <DialogDescription>Update the details or replace the attached file.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} data-testid="input-edit-evidence-title" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select value={editForm.evidenceType} onValueChange={(v) => setEditForm({ ...editForm, evidenceType: v })}>
                  <SelectTrigger data-testid="select-edit-evidence-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Collected on</Label>
                <Input type="date" value={editForm.collectedAt} onChange={(e) => setEditForm({ ...editForm, collectedAt: e.target.value })} data-testid="input-edit-evidence-collected" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source tool</Label>
                <Input placeholder="e.g. axe DevTools, Burp Suite" value={editForm.sourceTool} onChange={(e) => setEditForm({ ...editForm, sourceTool: e.target.value })} data-testid="input-edit-evidence-source" />
              </div>
              <div className="space-y-2">
                <Label>External URL</Label>
                <Input placeholder="https://…" value={editForm.externalUrl} onChange={(e) => setEditForm({ ...editForm, externalUrl: e.target.value })} data-testid="input-edit-evidence-url" />
              </div>
            </div>

            {/* ── Attached file section ── */}
            <div className="space-y-2">
              <Label>Attached file</Label>

              {/* Showing the replacement file the user just picked */}
              {editSelectedFile ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-muted/30">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate flex-1">{editSelectedFile.name}</span>
                  <span className="text-muted-foreground shrink-0">{formatBytes(editSelectedFile.size)}</span>
                  <span className="text-xs text-primary shrink-0">New</span>
                  <button type="button" onClick={clearEditFile} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Cancel replacement" data-testid="button-cancel-edit-file">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : editCurrentFile ? (
                /* Existing file on record */
                <div className="rounded-md border px-3 py-2 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate flex-1" data-testid="text-edit-evidence-filename">{editCurrentFile.name}</span>
                    {editCurrentFile.size != null && (
                      <span className="text-muted-foreground shrink-0 text-xs">{formatBytes(editCurrentFile.size)}</span>
                    )}
                    {mimeLabel(editCurrentFile.type) && (
                      <span className="text-muted-foreground shrink-0 text-xs font-mono" data-testid="text-edit-evidence-filetype">{mimeLabel(editCurrentFile.type)}</span>
                    )}
                    <a
                      href={editCurrentFile.url}
                      download={editCurrentFile.name}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      title="Download current file"
                      data-testid="link-edit-evidence-download"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </div>
                  {/* Inline image preview */}
                  {isImageMime(editCurrentFile.type) && (
                    <img
                      src={editCurrentFile.url}
                      alt={editCurrentFile.name}
                      className="max-h-40 rounded object-contain border"
                      data-testid="img-edit-evidence-preview"
                    />
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => editFileInputRef.current?.click()}
                      data-testid="button-replace-evidence-file"
                    >
                      Replace file
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => { setEditRemoveFile(true); }}
                      data-testid="button-remove-evidence-file"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : editRemoveFile ? (
                /* User chose to remove existing file */
                <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  <X className="h-4 w-4 shrink-0" />
                  <span className="flex-1">File will be removed on save.</span>
                  <button type="button" onClick={() => setEditRemoveFile(false)} className="hover:text-foreground underline text-xs" data-testid="button-undo-remove-file">
                    Undo
                  </button>
                </div>
              ) : (
                /* No file attached — offer to attach one */
                <div
                  className="flex items-center gap-2 rounded-md border border-dashed px-3 py-3 cursor-pointer hover:border-foreground/40 transition-colors"
                  onClick={() => editFileInputRef.current?.click()}
                  data-testid="dropzone-edit-evidence-file"
                >
                  <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground">
                    Click to attach a screenshot, PDF, or scan report (max 10 MB)
                  </span>
                </div>
              )}

              <input
                ref={editFileInputRef}
                type="file"
                accept={ALLOWED_MIME_TYPES.join(",")}
                className="hidden"
                onChange={handleEditFileChange}
                data-testid="input-edit-evidence-file"
              />
              {editUploadError && (
                <p className="text-xs text-destructive" data-testid="text-edit-evidence-file-error">{editUploadError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea rows={2} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} data-testid="input-edit-evidence-description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingEvidence(null); clearEditFile(); setEditRemoveFile(false); }} disabled={patchMutation.isPending} data-testid="button-cancel-edit-evidence">
              Cancel
            </Button>
            <Button
              onClick={() => patchMutation.mutate()}
              disabled={!editForm.title.trim() || patchMutation.isPending || !!editUploadError}
              data-testid="button-save-edit-evidence"
            >
              {patchMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {editSelectedFile ? "Uploading…" : "Saving…"}
                </>
              ) : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
