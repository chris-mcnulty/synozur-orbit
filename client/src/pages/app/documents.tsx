import React, { useState, useRef } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Trash2, Upload, FileType, Calendar, Building2, Brain } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Badge } from "@/components/ui/badge";
import { GROUNDING_DOC_CONTEXTS, GROUNDING_DOC_CONTEXT_LABELS, GROUNDING_DOC_CONTEXT_PRESETS } from "@shared/schema";

interface GroundingDocument {
  id: string;
  name: string;
  description: string | null;
  fileType: string;
  fileUrl: string;
  fileSize: number;
  extractedText: string | null;
  scope: string;
  useCase: string;
  contexts: string[] | null;
  competitorId: string | null;
  tenantDomain: string;
  createdAt: string;
}

interface Competitor {
  id: string;
  name: string;
}

const CONTEXT_DESCRIPTIONS: Record<string, string> = {
  competitive_analysis: "Grounds AI competitor website analysis and scoring",
  recommendations: "Grounds AI-generated strategic recommendations",
  executive_summary: "Grounds the executive summary dashboard",
  intelligence_briefing: "Grounds periodic intelligence briefing reports",
  marketing_content: "Grounds social post and content summary generation",
  email_generation: "Grounds email drafts across all platforms",
};

export default function Documents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState("tenant");
  const [competitorId, setCompetitorId] = useState<string | null>(null);
  const [selectedContexts, setSelectedContexts] = useState<string[]>([...GROUNDING_DOC_CONTEXT_PRESETS.intelligence]);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; url: string; size: number; type: string } | null>(null);
  const pendingUploadPathRef = useRef<string | null>(null);

  const { data: documents = [], isLoading } = useQuery<GroundingDocument[]>({
    queryKey: ["/api/documents"],
    queryFn: async () => {
      const response = await fetch("/api/documents", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch documents");
      return response.json();
    },
  });

  const { data: competitors = [] } = useQuery<Competitor[]>({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch competitors");
      return response.json();
    },
  });

  const addDocument = useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      fileType: string;
      fileUrl: string;
      fileSize: number;
      scope: string;
      useCase?: string;
      contexts?: string[];
      competitorId?: string | null;
    }) => {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to add document");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setIsDialogOpen(false);
      resetForm();
      toast({
        title: "Document Added",
        description: "Your grounding document has been uploaded and is being processed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteDocument = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/documents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete document");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "Document Removed",
        description: "The document has been removed from your library.",
      });
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setScope("tenant");
    setSelectedContexts([...GROUNDING_DOC_CONTEXT_PRESETS.intelligence]);
    setCompetitorId(null);
    setUploadedFile(null);
    pendingUploadPathRef.current = null;
  };

  const toggleContext = (context: string) => {
    setSelectedContexts((prev) =>
      prev.includes(context)
        ? prev.filter((c) => c !== context)
        : [...prev, context]
    );
  };

  const applyPreset = (preset: string) => {
    const presetContexts = GROUNDING_DOC_CONTEXT_PRESETS[preset];
    if (presetContexts) {
      setSelectedContexts([...presetContexts]);
    }
  };

  const deriveUseCase = (contexts: string[]): string => {
    const hasIntelligence = contexts.some(c =>
      ["competitive_analysis", "recommendations", "executive_summary", "intelligence_briefing"].includes(c)
    );
    const hasMarketing = contexts.some(c =>
      ["marketing_content", "email_generation"].includes(c)
    );
    if (hasMarketing && !hasIntelligence) return "marketing";
    return "intelligence";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadedFile) {
      toast({
        title: "Error",
        description: "Please upload a file first.",
        variant: "destructive",
      });
      return;
    }

    if (selectedContexts.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one AI context.",
        variant: "destructive",
      });
      return;
    }

    addDocument.mutate({
      name: name || uploadedFile.name,
      description: description || undefined,
      fileType: getFileExtension(uploadedFile.name),
      fileUrl: uploadedFile.url,
      fileSize: uploadedFile.size,
      scope,
      useCase: deriveUseCase(selectedContexts),
      contexts: selectedContexts,
      competitorId: scope === "competitor" ? competitorId : null,
    });
  };

  const getFileExtension = (filename: string): string => {
    return filename.split(".").pop()?.toLowerCase() || "txt";
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case "pdf":
        return <FileText className="w-5 h-5 text-red-500" />;
      case "docx":
      case "doc":
        return <FileText className="w-5 h-5 text-blue-500" />;
      case "md":
        return <FileType className="w-5 h-5 text-purple-500" />;
      default:
        return <FileText className="w-5 h-5 text-gray-500" />;
    }
  };

  const getDocContexts = (doc: GroundingDocument): string[] => {
    if (doc.contexts && Array.isArray(doc.contexts) && doc.contexts.length > 0) {
      return doc.contexts;
    }
    if (doc.useCase === "marketing") {
      return GROUNDING_DOC_CONTEXT_PRESETS.marketing;
    }
    return GROUNDING_DOC_CONTEXT_PRESETS.intelligence;
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading documents...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Documents</h1>
          <p className="text-muted-foreground">
            Upload positioning documents to ground AI analysis with your company context.
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all" data-testid="button-add-document">
              <Upload className="w-4 h-4 mr-2" /> Upload Document
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Upload Grounding Document</DialogTitle>
              <DialogDescription>
                Upload strategy documents, positioning guides, or competitor briefs to enhance AI analysis.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>File</Label>
                  {uploadedFile ? (
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                      {getFileIcon(getFileExtension(uploadedFile.name))}
                      <span className="flex-1 truncate">{uploadedFile.name}</span>
                      <span className="text-xs text-muted-foreground">{formatFileSize(uploadedFile.size)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setUploadedFile(null)}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <ObjectUploader
                      maxNumberOfFiles={1}
                      maxFileSize={20 * 1024 * 1024}
                      onGetUploadParameters={async (file) => {
                        const res = await fetch("/api/uploads/request-url", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            name: file.name,
                            size: file.size,
                            contentType: file.type,
                          }),
                          credentials: "include",
                        });
                        const { uploadURL, objectPath } = await res.json();
                        pendingUploadPathRef.current = objectPath;
                        return {
                          method: "PUT" as const,
                          url: uploadURL,
                          headers: { "Content-Type": file.type || "application/octet-stream" },
                        };
                      }}
                      onComplete={(result) => {
                        const file = result.successful?.[0];
                        if (file && pendingUploadPathRef.current) {
                          setUploadedFile({
                            name: file.name,
                            url: pendingUploadPathRef.current,
                            size: file.size || 0,
                            type: file.type || "application/octet-stream",
                          });
                        }
                      }}
                      buttonClassName="w-full"
                    >
                      <Upload className="w-4 h-4 mr-2" /> Choose File (PDF, DOCX, TXT, MD)
                    </ObjectUploader>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="name">Document Name (optional)</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Q4 2024 Strategy Brief"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="input-document-name"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    placeholder="Brief description of the document contents..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    data-testid="input-document-description"
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Scope</Label>
                  <Select value={scope} onValueChange={setScope}>
                    <SelectTrigger data-testid="select-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tenant">Organization-wide</SelectItem>
                      <SelectItem value="competitor">Specific Competitor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {scope === "competitor" && (
                  <div className="grid gap-2">
                    <Label>Competitor</Label>
                    <Select value={competitorId || ""} onValueChange={setCompetitorId}>
                      <SelectTrigger data-testid="select-competitor">
                        <SelectValue placeholder="Select a competitor" />
                      </SelectTrigger>
                      <SelectContent>
                        {competitors.map((comp) => (
                          <SelectItem key={comp.id} value={comp.id}>
                            {comp.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid gap-2">
                  <Label className="flex items-center gap-1.5">
                    <Brain className="w-4 h-4" />
                    AI Contexts
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Select which AI features should use this document as grounding context.
                  </p>
                  <div className="flex gap-2 mb-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => applyPreset("all")}
                      className={selectedContexts.length === GROUNDING_DOC_CONTEXTS.length ? "border-primary bg-primary/5" : ""}
                      data-testid="button-preset-all"
                    >
                      All
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => applyPreset("intelligence")}
                      className={JSON.stringify([...selectedContexts].sort()) === JSON.stringify([...GROUNDING_DOC_CONTEXT_PRESETS.intelligence].sort()) ? "border-primary bg-primary/5" : ""}
                      data-testid="button-preset-intelligence"
                    >
                      Intelligence
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => applyPreset("marketing")}
                      className={JSON.stringify([...selectedContexts].sort()) === JSON.stringify([...GROUNDING_DOC_CONTEXT_PRESETS.marketing].sort()) ? "border-primary bg-primary/5" : ""}
                      data-testid="button-preset-marketing"
                    >
                      Marketing
                    </Button>
                  </div>
                  <div className="border rounded-lg p-3 space-y-3 max-h-[200px] overflow-y-auto">
                    {GROUNDING_DOC_CONTEXTS.map((ctx) => (
                      <div key={ctx} className="flex items-start gap-3">
                        <Checkbox
                          id={`ctx-${ctx}`}
                          checked={selectedContexts.includes(ctx)}
                          onCheckedChange={() => toggleContext(ctx)}
                          data-testid={`checkbox-context-${ctx}`}
                        />
                        <div className="grid gap-0.5 leading-none">
                          <label
                            htmlFor={`ctx-${ctx}`}
                            className="text-sm font-medium cursor-pointer"
                          >
                            {GROUNDING_DOC_CONTEXT_LABELS[ctx]}
                          </label>
                          <p className="text-xs text-muted-foreground">
                            {CONTEXT_DESCRIPTIONS[ctx]}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={addDocument.isPending || !uploadedFile || selectedContexts.length === 0} data-testid="button-submit-document">
                  {addDocument.isPending ? "Uploading..." : "Add Document"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {documents.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">No documents yet</h3>
          <p className="text-muted-foreground mb-4">
            Upload positioning documents, strategy briefs, or competitor analyses to enhance AI recommendations.
          </p>
          <Button onClick={() => setIsDialogOpen(true)} data-testid="button-upload-first">
            <Upload className="w-4 h-4 mr-2" /> Upload Your First Document
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700 fill-mode-backwards delay-100">
          {documents.map((doc) => {
            const docContexts = getDocContexts(doc);
            return (
              <Card key={doc.id} className="hover:border-primary/30 transition-colors" data-testid={`card-document-${doc.id}`}>
                <CardContent className="flex items-center justify-between p-6">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      {getFileIcon(doc.fileType)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{doc.name}</h3>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <FileType className="w-3 h-3" />
                          {doc.fileType.toUpperCase()}
                        </span>
                        <span>{formatFileSize(doc.fileSize)}</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(doc.createdAt)}
                        </span>
                      </div>
                      {doc.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{doc.description}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {docContexts.map((ctx) => (
                          <Badge key={ctx} variant="outline" className="text-[10px] px-1.5 py-0">
                            {GROUNDING_DOC_CONTEXT_LABELS[ctx] || ctx}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 ml-4">
                    <div className="flex items-center gap-2">
                      <Badge variant={doc.scope === "tenant" ? "secondary" : "outline"}>
                        {doc.scope === "tenant" ? (
                          <>
                            <Building2 className="w-3 h-3 mr-1" />
                            Org-wide
                          </>
                        ) : (
                          "Competitor"
                        )}
                      </Badge>
                      {doc.extractedText ? (
                        <Badge variant="default" className="bg-green-600">Processed</Badge>
                      ) : (
                        <Badge variant="secondary">Processing...</Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteDocument.mutate(doc.id)}
                      disabled={deleteDocument.isPending}
                      data-testid={`button-delete-${doc.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
