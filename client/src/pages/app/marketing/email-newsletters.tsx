import { useState, useEffect, useMemo } from "react";
import DOMPurify from "dompurify";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  Lock,
  Filter,
  Pencil,
  Sparkles,
  Loader2,
  Copy,
  Lightbulb,
  ChevronDown,
  Trash2,
  Search,
  ImageIcon,
  Calendar,
  Eye,
} from "lucide-react";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";

interface ContentAsset {
  id: string;
  title: string;
  description?: string;
  aiSummary?: string;
  leadImageUrl?: string;
  url?: string;
  categoryId?: string;
  createdAt: string;
  status: string;
}

interface Category {
  id: string;
  name: string;
}

interface SavedEmail {
  id: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  platform?: string;
  tone?: string;
  status: string;
  subjectLineSuggestions?: string[];
  coachingTips?: string[];
  createdAt: string;
}

interface PreviewEmail {
  subject: string;
  htmlBody: string;
  textBody?: string;
  platform: string;
  subjectLineSuggestions?: string[];
  coachingTips?: string[];
}

export default function EmailNewslettersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const preselectedAssetId = params.get("assetId");

  const [emailPlatform, setEmailPlatform] = useState("outlook");
  const [emailTone, setEmailTone] = useState("professional");
  const [emailCallToAction, setEmailCallToAction] = useState("");
  const [emailRecipientContext, setEmailRecipientContext] = useState("");
  const [emailInstructions, setEmailInstructions] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [previewEmail, setPreviewEmail] = useState<PreviewEmail | null>(null);
  const [coachingTipsOpen, setCoachingTipsOpen] = useState(false);

  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [assetCategoryFilter, setAssetCategoryFilter] = useState<string>("all");
  const [assetDateSort, setAssetDateSort] = useState<string>("newest");

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingEmail, setEditingEmail] = useState<SavedEmail | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [viewingEmail, setViewingEmail] = useState<SavedEmail | null>(null);

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const isAllowed = tenantInfo?.features?.emailNewsletters === true;

  const { data: contentAssets = [] } = useQuery<ContentAsset[]>({
    queryKey: ["/api/content-assets"],
    queryFn: async () => {
      const r = await fetch("/api/content-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/content-asset-categories"],
    queryFn: async () => {
      const r = await fetch("/api/content-asset-categories", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: savedEmails = [] } = useQuery<SavedEmail[]>({
    queryKey: ["/api/email/saved"],
    queryFn: async () => {
      const r = await fetch("/api/email/saved", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  useEffect(() => {
    if (preselectedAssetId && contentAssets.length > 0) {
      const exists = contentAssets.some(a => a.id === preselectedAssetId);
      if (exists && !selectedAssetIds.includes(preselectedAssetId)) {
        setSelectedAssetIds(prev => [...prev, preselectedAssetId]);
      }
    }
  }, [preselectedAssetId, contentAssets]);

  const categoryName = (catId?: string) => {
    if (!catId) return "";
    return categories.find(c => c.id === catId)?.name || "";
  };

  const activeAssets = contentAssets.filter(a => a.status === "active");

  const filteredAssets = useMemo(() => {
    let list = activeAssets;
    if (assetSearchQuery) {
      const q = assetSearchQuery.toLowerCase();
      list = list.filter(a =>
        a.title.toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q)
      );
    }
    if (assetCategoryFilter !== "all") {
      list = list.filter(a => a.categoryId === assetCategoryFilter);
    }
    list = [...list].sort((a, b) => {
      if (assetDateSort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return list;
  }, [activeAssets, assetSearchQuery, assetCategoryFilter, assetDateSort]);

  const usedCategories = useMemo(() => {
    const ids = new Set(activeAssets.map(a => a.categoryId).filter(Boolean));
    return categories.filter(c => ids.has(c.id));
  }, [activeAssets, categories]);

  const updateEmailMutation = useMutation({
    mutationFn: async ({ emailId, subject, body, isHtml }: { emailId: string; subject: string; body: string; isHtml: boolean }) => {
      const payload: Record<string, string> = { subject };
      if (isHtml) {
        payload.htmlBody = body;
      } else {
        payload.textBody = body;
      }
      const r = await fetch(`/api/email/saved/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setEditingEmail(null);
      toast({ title: "Email updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteEmailMutation = useMutation({
    mutationFn: async (emailId: string) => {
      const r = await fetch(`/api/email/saved/${emailId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setDeleteConfirmId(null);
      toast({ title: "Email deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleAsset = (assetId: string) => {
    setSelectedAssetIds(prev =>
      prev.includes(assetId)
        ? prev.filter(id => id !== assetId)
        : [...prev, assetId]
    );
  };

  const handleGenerateEmail = async () => {
    setGeneratingEmail(true);
    try {
      const r = await fetch("/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          assetIds: selectedAssetIds,
          instructions: emailInstructions,
          platform: emailPlatform,
          tone: emailTone,
          callToAction: emailCallToAction || undefined,
          recipientContext: emailRecipientContext || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const data = await r.json();
      setPreviewEmail({
        subject: data.subject,
        htmlBody: data.htmlBody,
        textBody: data.textBody,
        platform: data.platform,
        subjectLineSuggestions: data.subjectLineSuggestions,
        coachingTips: data.coachingTips,
      });
      setCoachingTipsOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingEmail(false);
    }
  };

  const saveEmailMutation = useMutation({
    mutationFn: async () => {
      if (!previewEmail) return;
      const r = await fetch("/api/email/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          platform: emailPlatform,
          tone: emailTone,
          callToAction: emailCallToAction || undefined,
          recipientContext: emailRecipientContext || undefined,
          subject: previewEmail.subject,
          htmlBody: previewEmail.htmlBody,
          textBody: previewEmail.textBody,
          subjectLineSuggestions: previewEmail.subjectLineSuggestions,
          coachingTips: previewEmail.coachingTips,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setPreviewEmail(null);
      toast({ title: "Email saved" });
    },
  });

  const filteredEmails = savedEmails.filter(e => {
    if (statusFilter === "all") return true;
    return e.status === statusFilter;
  });

  const PLATFORM_LABELS: Record<string, string> = {
    "outlook": "Outlook",
    "hubspot-marketing": "HubSpot Marketing",
    "hubspot-1to1": "HubSpot 1:1",
    "dynamics-365": "Dynamics 365",
  };

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center" data-testid="card-email-newsletters-coming-soon">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle data-testid="text-email-newsletters-title">Email Newsletter Generator</CardTitle>
              <CardDescription>
                Create AI-powered promotional emails from your content assets and market intelligence. Available on the Enterprise plan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" asChild data-testid="button-email-newsletters-contact-sales">
                <a href="mailto:contactus@synozur.com?subject=Enterprise%20Plan%20Inquiry%20-%20Email%20Newsletters">
                  Contact Sales
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6" /> Email Newsletters
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate AI-drafted emails from your content assets and marketing grounding documents.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate Email</CardTitle>
            <CardDescription>Select content assets and configure your email generation settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeAssets.length > 0 && (
              <div>
                <label className="text-sm font-medium mb-2 block">Content Assets</label>

                <div className="flex flex-wrap gap-2 mb-2">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      value={assetSearchQuery}
                      onChange={e => setAssetSearchQuery(e.target.value)}
                      placeholder="Search assets..."
                      className="h-8 pl-8 text-sm"
                      data-testid="input-asset-search"
                    />
                  </div>
                  <Select value={assetCategoryFilter} onValueChange={setAssetCategoryFilter}>
                    <SelectTrigger className="h-8 w-[160px] text-sm" data-testid="select-asset-category-filter">
                      <Filter className="w-3 h-3 mr-1 text-muted-foreground" />
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {usedCategories.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={assetDateSort} onValueChange={setAssetDateSort}>
                    <SelectTrigger className="h-8 w-[130px] text-sm" data-testid="select-asset-date-sort">
                      <Calendar className="w-3 h-3 mr-1 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest First</SelectItem>
                      <SelectItem value="oldest">Oldest First</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="border rounded-lg max-h-64 overflow-y-auto">
                  {filteredAssets.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">No assets match your filters.</div>
                  ) : (
                    filteredAssets.map(asset => (
                      <label
                        key={asset.id}
                        className={`flex items-start gap-3 cursor-pointer hover:bg-muted/50 p-3 border-b last:border-b-0 transition-colors ${
                          selectedAssetIds.includes(asset.id) ? "bg-primary/5" : ""
                        }`}
                      >
                        <Checkbox
                          checked={selectedAssetIds.includes(asset.id)}
                          onCheckedChange={() => toggleAsset(asset.id)}
                          className="mt-0.5"
                          data-testid={`checkbox-asset-${asset.id}`}
                        />
                        {asset.leadImageUrl ? (
                          <div className="w-12 h-12 rounded border overflow-hidden shrink-0 bg-muted">
                            <img
                              src={asset.leadImageUrl}
                              alt=""
                              className="w-full h-full object-cover"
                              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded border flex items-center justify-center shrink-0 bg-muted/50">
                            <ImageIcon className="w-5 h-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight">{asset.title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {categoryName(asset.categoryId) && (
                              <Badge variant="outline" className="text-[10px] h-4">{categoryName(asset.categoryId)}</Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground">{format(new Date(asset.createdAt), "MMM d, yyyy")}</span>
                          </div>
                          {asset.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{asset.description}</p>
                          )}
                        </div>
                      </label>
                    ))
                  )}
                </div>
                {selectedAssetIds.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">{selectedAssetIds.length} asset{selectedAssetIds.length !== 1 ? "s" : ""} selected</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Platform</label>
                <Select value={emailPlatform} onValueChange={setEmailPlatform}>
                  <SelectTrigger data-testid="select-email-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outlook">Outlook</SelectItem>
                    <SelectItem value="hubspot-marketing">HubSpot Marketing Email</SelectItem>
                    <SelectItem value="hubspot-1to1">HubSpot 1:1 Email</SelectItem>
                    <SelectItem value="dynamics-365">Dynamics 365 Customer Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Tone</label>
                <Select value={emailTone} onValueChange={setEmailTone}>
                  <SelectTrigger data-testid="select-email-tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Call to Action (optional)</label>
              <Input
                value={emailCallToAction}
                onChange={e => setEmailCallToAction(e.target.value)}
                placeholder="e.g. Book a demo, Download the whitepaper..."
                data-testid="input-email-cta"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Recipient Context (optional)</label>
              <Input
                value={emailRecipientContext}
                onChange={e => setEmailRecipientContext(e.target.value)}
                placeholder="e.g. IT decision makers at mid-market companies..."
                data-testid="input-email-recipient-context"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Additional Instructions (optional)</label>
              <Textarea
                value={emailInstructions}
                onChange={e => setEmailInstructions(e.target.value)}
                placeholder="e.g. Focus on the enterprise audience, highlight ROI..."
                rows={3}
                data-testid="input-email-instructions"
              />
            </div>
            <Button
              onClick={handleGenerateEmail}
              disabled={generatingEmail || selectedAssetIds.length === 0}
              className="gap-2"
              data-testid="button-generate-email"
            >
              {generatingEmail ? <><Loader2 className="w-4 h-4 animate-spin" />Generating...</> : <><Sparkles className="w-4 h-4" />Generate Email</>}
            </Button>
            {selectedAssetIds.length === 0 && activeAssets.length > 0 && (
              <p className="text-xs text-muted-foreground">Select at least one content asset to generate an email.</p>
            )}
          </CardContent>
        </Card>

        {previewEmail && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Preview: {previewEmail.subject}</CardTitle>
                <Button size="sm" onClick={() => saveEmailMutation.mutate()} disabled={saveEmailMutation.isPending} data-testid="button-save-email">
                  Save Email
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {previewEmail.subjectLineSuggestions && previewEmail.subjectLineSuggestions.length > 0 && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Subject Line Suggestions</label>
                  <ol className="space-y-1">
                    {previewEmail.subjectLineSuggestions.map((line, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-sm border rounded px-3 py-2 bg-muted/30" data-testid={`text-subject-suggestion-${i}`}>
                        <span>{i + 1}. {line}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0"
                          onClick={() => {
                            navigator.clipboard.writeText(line);
                            toast({ title: "Copied", description: "Subject line copied to clipboard" });
                          }}
                          data-testid={`button-copy-subject-${i}`}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="relative">
                <div className="absolute top-2 right-2 z-10 flex gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 gap-1.5 text-xs shadow-sm"
                    onClick={() => {
                      const content = previewEmail.platform === "hubspot-marketing"
                        ? previewEmail.htmlBody
                        : (previewEmail.textBody || previewEmail.htmlBody);
                      navigator.clipboard.writeText(content);
                      toast({
                        title: "Copied",
                        description: previewEmail.platform === "hubspot-marketing"
                          ? "HTML copied to clipboard — paste into your email editor"
                          : "Email body copied to clipboard",
                      });
                    }}
                    data-testid="button-copy-email-body"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {previewEmail.platform === "hubspot-marketing" ? "Copy HTML" : "Copy Text"}
                  </Button>
                </div>
                {previewEmail.platform === "hubspot-marketing" ? (
                  <div
                    className="border rounded bg-white text-black text-sm overflow-y-auto"
                    style={{ maxHeight: "600px" }}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewEmail.htmlBody) }}
                    data-testid="preview-email-html"
                  />
                ) : (
                  <pre className="border rounded p-4 bg-white text-black text-sm max-h-96 overflow-y-auto whitespace-pre-wrap font-sans" data-testid="preview-email-text">
                    {previewEmail.textBody || previewEmail.htmlBody}
                  </pre>
                )}
              </div>

              {previewEmail.coachingTips && previewEmail.coachingTips.length > 0 && (
                <Collapsible open={coachingTipsOpen} onOpenChange={setCoachingTipsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2 w-full justify-start text-muted-foreground" data-testid="button-toggle-coaching-tips">
                      <Lightbulb className="w-4 h-4" />
                      Coaching Tips
                      <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${coachingTipsOpen ? "rotate-180" : ""}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground pl-6 list-disc">
                      {previewEmail.coachingTips.map((tip, i) => (
                        <li key={i} data-testid={`text-coaching-tip-${i}`}>{tip}</li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </CardContent>
          </Card>
        )}

        {savedEmails.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Saved Emails</h2>
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36" data-testid="select-email-status-filter">
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {filteredEmails.map(email => (
              <Card key={email.id} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setViewingEmail(email)} data-testid={`card-email-${email.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{email.subject}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {email.platform && (
                          <Badge variant="secondary" className="text-[10px]">
                            {PLATFORM_LABELS[email.platform] || email.platform}
                          </Badge>
                        )}
                        {email.tone && (
                          <Badge variant="outline" className="text-[10px] capitalize">{email.tone}</Badge>
                        )}
                        <p className="text-xs text-muted-foreground">{format(new Date(email.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="capitalize">{email.status}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={email.platform === "hubspot-marketing" ? "Copy HTML" : "Copy email body"}
                        onClick={() => {
                          const content = email.platform === "hubspot-marketing"
                            ? email.htmlBody
                            : (email.textBody || email.htmlBody);
                          navigator.clipboard.writeText(content);
                          toast({
                            title: "Copied",
                            description: email.platform === "hubspot-marketing"
                              ? "HTML copied to clipboard"
                              : "Email body copied to clipboard",
                          });
                        }}
                        data-testid={`button-copy-email-${email.id}`}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Edit email"
                        onClick={() => {
                          setEditingEmail(email);
                          setEditSubject(email.subject);
                          setEditBody(email.platform === "hubspot-marketing" ? email.htmlBody : (email.textBody || email.htmlBody));
                        }}
                        data-testid={`button-edit-email-${email.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        title="Delete email"
                        onClick={() => setDeleteConfirmId(email.id)}
                        data-testid={`button-delete-email-${email.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {savedEmails.length === 0 && !previewEmail && (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <Mail className="w-10 h-10 mx-auto text-muted-foreground" />
              <div>
                <p className="font-medium">No saved emails yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Select content assets above, configure your settings, and generate an email to get started.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={!!editingEmail} onOpenChange={v => { if (!v) setEditingEmail(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Email</DialogTitle>
              <DialogDescription>Modify the subject line and email body.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Subject</Label>
                <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} data-testid="input-edit-email-subject" />
              </div>
              <div>
                <Label>{editingEmail?.platform === "hubspot-marketing" ? "HTML Body" : "Email Body"}</Label>
                <Textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={12} className="font-mono text-xs" data-testid="input-edit-email-body" />
              </div>
              <Button
                className="w-full"
                disabled={!editSubject.trim() || updateEmailMutation.isPending}
                onClick={() => {
                  if (editingEmail) {
                    updateEmailMutation.mutate({
                      emailId: editingEmail.id,
                      subject: editSubject,
                      body: editBody,
                      isHtml: editingEmail.platform === "hubspot-marketing",
                    });
                  }
                }}
                data-testid="button-save-edit-email"
              >
                {updateEmailMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteConfirmId} onOpenChange={v => { if (!v) setDeleteConfirmId(null); }}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Delete Email</DialogTitle>
              <DialogDescription>Are you sure you want to delete this saved email? This cannot be undone.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)} data-testid="button-cancel-delete-email">Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => { if (deleteConfirmId) deleteEmailMutation.mutate(deleteConfirmId); }}
                disabled={deleteEmailMutation.isPending}
                data-testid="button-confirm-delete-email"
              >
                {deleteEmailMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
