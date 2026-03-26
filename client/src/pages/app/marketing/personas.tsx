import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  UserCircle,
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  Download,
  Loader2,
  Lock,
  Briefcase,
  Building2,
  Target,
  MessageSquare,
  Star,
  X,
  ClipboardPaste,
} from "lucide-react";

interface Persona {
  id: string;
  tenantDomain: string;
  marketId: string | null;
  name: string;
  role: string | null;
  industry: string | null;
  companySize: string | null;
  painPoints: string[] | null;
  goals: string[] | null;
  objections: string[] | null;
  preferredChannels: string[] | null;
  notes: string | null;
  isIcp: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface PersonaFormData {
  name: string;
  role: string;
  industry: string;
  companySize: string;
  painPoints: string[];
  goals: string[];
  objections: string[];
  preferredChannels: string[];
  notes: string;
  isIcp: boolean;
}

const emptyForm: PersonaFormData = {
  name: "",
  role: "",
  industry: "",
  companySize: "",
  painPoints: [],
  goals: [],
  objections: [],
  preferredChannels: [],
  notes: "",
  isIcp: false,
};

const CHANNEL_OPTIONS = [
  "LinkedIn", "Email", "Twitter/X", "Webinars", "Conferences",
  "Direct Mail", "Phone", "Blog", "YouTube", "Podcasts",
  "Instagram", "Facebook", "Reddit", "Slack Communities",
];

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
      setInput("");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          placeholder={placeholder}
          className="flex-1"
          data-testid={`input-tag-${placeholder.toLowerCase().replace(/\s+/g, "-")}`}
        />
        <Button type="button" variant="outline" size="sm" onClick={addTag} data-testid={`button-add-tag-${placeholder.toLowerCase().replace(/\s+/g, "-")}`}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag, i) => (
            <Badge key={i} variant="secondary" className="gap-1 pr-1">
              {tag}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                className="ml-1 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PersonasPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [formData, setFormData] = useState<PersonaFormData>(emptyForm);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [featureGated, setFeatureGated] = useState(false);
  const [ingestDialogOpen, setIngestDialogOpen] = useState(false);
  const [ingestText, setIngestText] = useState("");
  const [ingestLoading, setIngestLoading] = useState(false);

  const { data: personas = [], isLoading } = useQuery<Persona[]>({
    queryKey: ["/api/personas"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: PersonaFormData) => {
      const res = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        if (res.status === 403 && err.upgradeRequired) {
          setFeatureGated(true);
          throw new Error("Feature requires Pro plan or higher");
        }
        throw new Error(err.error || "Failed to create persona");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
      setDialogOpen(false);
      setFormData(emptyForm);
      setEditingPersona(null);
      toast({ title: "Persona created" });
    },
    onError: (err: Error) => {
      if (!featureGated) toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PersonaFormData }) => {
      const res = await fetch(`/api/personas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update persona");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
      setDialogOpen(false);
      setFormData(emptyForm);
      setEditingPersona(null);
      toast({ title: "Persona updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/personas/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete persona");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
      toast({ title: "Persona deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleEdit = (persona: Persona) => {
    setEditingPersona(persona);
    setFormData({
      name: persona.name,
      role: persona.role || "",
      industry: persona.industry || "",
      companySize: persona.companySize || "",
      painPoints: persona.painPoints || [],
      goals: persona.goals || [],
      objections: persona.objections || [],
      preferredChannels: persona.preferredChannels || [],
      notes: persona.notes || "",
      isIcp: persona.isIcp,
    });
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingPersona(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) return;
    if (editingPersona) {
      updateMutation.mutate({ id: editingPersona.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleAiGenerate = async () => {
    setAiGenerating(true);
    try {
      const res = await fetch("/api/personas/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        if (res.status === 403 && err.upgradeRequired) {
          setFeatureGated(true);
          return;
        }
        throw new Error(err.error || "Failed to generate personas");
      }
      const suggestions = await res.json();
      setAiSuggestions(suggestions);
      setAiDialogOpen(true);
    } catch (err: any) {
      if (!featureGated) toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAiGenerating(false);
    }
  };

  const handleIngestText = async () => {
    if (!ingestText.trim() || ingestText.trim().length < 10) {
      toast({ title: "Too short", description: "Please paste more text for AI to extract a persona from.", variant: "destructive" });
      return;
    }
    setIngestLoading(true);
    try {
      const res = await fetch("/api/personas/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: ingestText }),
      });
      if (!res.ok) {
        const err = await res.json();
        if (res.status === 403 && err.upgradeRequired) {
          setFeatureGated(true);
          return;
        }
        throw new Error(err.error || "Failed to extract persona");
      }
      const extracted = await res.json();
      if (extracted.error) throw new Error(extracted.error);
      setFormData({
        name: extracted.name || "",
        role: extracted.role || "",
        industry: extracted.industry || "",
        companySize: extracted.companySize || "",
        painPoints: Array.isArray(extracted.painPoints) ? extracted.painPoints : [],
        goals: Array.isArray(extracted.goals) ? extracted.goals : [],
        objections: Array.isArray(extracted.objections) ? extracted.objections : [],
        preferredChannels: Array.isArray(extracted.preferredChannels) ? extracted.preferredChannels : [],
        notes: extracted.notes || "",
        isIcp: false,
      });
      setIngestDialogOpen(false);
      setIngestText("");
      setEditingPersona(null);
      setDialogOpen(true);
      toast({ title: "Persona extracted", description: "Review the extracted details and save when ready." });
    } catch (err: any) {
      if (!featureGated) toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIngestLoading(false);
    }
  };

  const handleAcceptSuggestion = async (suggestion: any) => {
    try {
      const res = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: suggestion.name,
          role: suggestion.role,
          industry: suggestion.industry,
          companySize: suggestion.companySize,
          painPoints: suggestion.painPoints,
          goals: suggestion.goals,
          objections: suggestion.objections,
          preferredChannels: suggestion.preferredChannels,
          notes: suggestion.notes,
          isIcp: false,
        }),
      });
      if (!res.ok) throw new Error("Failed to save persona");
      queryClient.invalidateQueries({ queryKey: ["/api/personas"] });
      setAiSuggestions(prev => prev.filter(s => s !== suggestion));
      toast({ title: "Persona saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleCsvExport = () => {
    if (personas.length === 0) return;
    const headers = ["Name", "Role", "Industry", "Company Size", "Pain Points", "Goals", "Objections", "Preferred Channels", "Notes", "ICP"];
    const rows = personas.map(p => [
      p.name,
      p.role || "",
      p.industry || "",
      p.companySize || "",
      (p.painPoints || []).join("; "),
      (p.goals || []).join("; "),
      (p.objections || []).join("; "),
      (p.preferredChannels || []).join("; "),
      p.notes || "",
      p.isIcp ? "Yes" : "No",
    ]);
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${(cell || "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "personas.csv";
    link.click();
  };

  if (featureGated) {
    return (
      <AppLayout>
        <div className="mb-8">
          <div className="h-1 w-full bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 rounded-full mb-6" />
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <UserCircle className="h-8 w-8 text-purple-500" />
            Personas & ICP Builder
          </h1>
          <p className="text-muted-foreground">Define buyer personas to make AI-generated content more targeted and relevant.</p>
        </div>
        <Card className="max-w-lg mx-auto">
          <CardContent className="pt-8 text-center space-y-4">
            <Lock className="h-12 w-12 mx-auto text-muted-foreground" />
            <h3 className="text-lg font-semibold">Upgrade to Pro</h3>
            <p className="text-sm text-muted-foreground">
              The Persona & ICP Builder is available on Pro, Enterprise, and Unlimited plans.
              Define buyer personas to inject audience context into campaigns, emails, battlecards, and recommendations.
            </p>
            <Button onClick={() => window.location.href = "/pricing"} data-testid="button-upgrade-plan">
              View Plans
            </Button>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8">
        <div className="h-1 w-full bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 rounded-full mb-6" />
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3">
              <UserCircle className="h-8 w-8 text-purple-500" />
              Personas & ICP Builder
            </h1>
            <p className="text-muted-foreground">Define buyer personas and ideal customer profiles to make AI content more targeted.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCsvExport} disabled={personas.length === 0} data-testid="button-export-csv">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => setIngestDialogOpen(true)} data-testid="button-import-text">
              <ClipboardPaste className="h-4 w-4 mr-2" />
              Import from Text
            </Button>
            <Button variant="outline" onClick={handleAiGenerate} disabled={aiGenerating} data-testid="button-ai-generate">
              {aiGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              AI Suggest
            </Button>
            <Button onClick={handleCreate} data-testid="button-create-persona">
              <Plus className="h-4 w-4 mr-2" />
              New Persona
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : personas.length === 0 ? (
        <Card className="max-w-lg mx-auto" data-testid="card-empty-state">
          <CardContent className="pt-8 text-center space-y-4">
            <UserCircle className="h-12 w-12 mx-auto text-muted-foreground" />
            <h3 className="text-lg font-semibold">No personas defined</h3>
            <p className="text-sm text-muted-foreground">
              Create buyer personas manually or let AI suggest personas based on your competitive intelligence.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button variant="outline" onClick={() => setIngestDialogOpen(true)} data-testid="button-import-text-empty">
                <ClipboardPaste className="h-4 w-4 mr-2" />
                Import from Text
              </Button>
              <Button variant="outline" onClick={handleAiGenerate} disabled={aiGenerating} data-testid="button-ai-suggest-empty">
                {aiGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                AI Suggest
              </Button>
              <Button onClick={handleCreate} data-testid="button-create-first-persona">
                <Plus className="h-4 w-4 mr-2" />
                Create Persona
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {personas.map(persona => (
            <Card key={persona.id} className="group relative" data-testid={`card-persona-${persona.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                      <UserCircle className="h-6 w-6 text-purple-500" />
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {persona.name}
                        {persona.isIcp && (
                          <Badge variant="default" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                            <Star className="h-3 w-3 mr-1" />
                            ICP
                          </Badge>
                        )}
                      </CardTitle>
                      {persona.role && <CardDescription className="text-sm">{persona.role}</CardDescription>}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(persona)} data-testid={`button-edit-${persona.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteMutation.mutate(persona.id)}
                      data-testid={`button-delete-${persona.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {(persona.industry || persona.companySize) && (
                  <div className="flex flex-wrap gap-2">
                    {persona.industry && (
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Building2 className="h-3 w-3" />
                        {persona.industry}
                      </Badge>
                    )}
                    {persona.companySize && (
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Briefcase className="h-3 w-3" />
                        {persona.companySize}
                      </Badge>
                    )}
                  </div>
                )}

                {persona.painPoints && persona.painPoints.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                      <Target className="h-3 w-3" /> Pain Points
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {persona.painPoints.slice(0, 3).map((p, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{p}</Badge>
                      ))}
                      {persona.painPoints.length > 3 && (
                        <Badge variant="secondary" className="text-xs">+{persona.painPoints.length - 3}</Badge>
                      )}
                    </div>
                  </div>
                )}

                {persona.goals && persona.goals.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">Goals</span>
                    <div className="flex flex-wrap gap-1">
                      {persona.goals.slice(0, 3).map((g, i) => (
                        <Badge key={i} variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">{g}</Badge>
                      ))}
                      {persona.goals.length > 3 && (
                        <Badge variant="secondary" className="text-xs">+{persona.goals.length - 3}</Badge>
                      )}
                    </div>
                  </div>
                )}

                {persona.preferredChannels && persona.preferredChannels.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                      <MessageSquare className="h-3 w-3" /> Channels
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {persona.preferredChannels.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {persona.notes && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{persona.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPersona ? "Edit Persona" : "Create Persona"}</DialogTitle>
            <DialogDescription>
              {editingPersona ? "Update buyer persona details." : "Define a new buyer persona to target with your content."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Enterprise IT Director"
                  data-testid="input-persona-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Role / Job Title</Label>
                <Input
                  value={formData.role}
                  onChange={(e) => setFormData(f => ({ ...f, role: e.target.value }))}
                  placeholder="e.g. VP of Engineering"
                  data-testid="input-persona-role"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Industry</Label>
                <Input
                  value={formData.industry}
                  onChange={(e) => setFormData(f => ({ ...f, industry: e.target.value }))}
                  placeholder="e.g. SaaS, Healthcare"
                  data-testid="input-persona-industry"
                />
              </div>
              <div className="space-y-2">
                <Label>Company Size</Label>
                <Input
                  value={formData.companySize}
                  onChange={(e) => setFormData(f => ({ ...f, companySize: e.target.value }))}
                  placeholder="e.g. 200-500 employees"
                  data-testid="input-persona-company-size"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Pain Points</Label>
              <TagInput
                value={formData.painPoints}
                onChange={(v) => setFormData(f => ({ ...f, painPoints: v }))}
                placeholder="Add a pain point and press Enter"
              />
            </div>
            <div className="space-y-2">
              <Label>Goals</Label>
              <TagInput
                value={formData.goals}
                onChange={(v) => setFormData(f => ({ ...f, goals: v }))}
                placeholder="Add a goal and press Enter"
              />
            </div>
            <div className="space-y-2">
              <Label>Objections</Label>
              <TagInput
                value={formData.objections}
                onChange={(v) => setFormData(f => ({ ...f, objections: v }))}
                placeholder="Add an objection and press Enter"
              />
            </div>
            <div className="space-y-2">
              <Label>Preferred Channels</Label>
              <div className="flex flex-wrap gap-2">
                {CHANNEL_OPTIONS.map(ch => (
                  <Badge
                    key={ch}
                    variant={formData.preferredChannels.includes(ch) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => {
                      setFormData(f => ({
                        ...f,
                        preferredChannels: f.preferredChannels.includes(ch)
                          ? f.preferredChannels.filter(c => c !== ch)
                          : [...f.preferredChannels, ch],
                      }));
                    }}
                  >
                    {ch}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData(f => ({ ...f, notes: e.target.value }))}
                placeholder="Additional context about this persona..."
                rows={3}
                data-testid="input-persona-notes"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={formData.isIcp}
                onCheckedChange={(v) => setFormData(f => ({ ...f, isIcp: v }))}
                data-testid="switch-persona-icp"
              />
              <Label className="cursor-pointer">Mark as Ideal Customer Profile (ICP)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-persona">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.name.trim() || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-persona"
            >
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingPersona ? "Save Changes" : "Create Persona"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Suggestions Dialog */}
      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              AI-Suggested Personas
            </DialogTitle>
            <DialogDescription>
              Review these persona suggestions generated from your competitive intelligence. Accept the ones you want to keep.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {aiSuggestions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">All suggestions have been accepted!</p>
            ) : (
              aiSuggestions.map((suggestion, idx) => (
                <Card key={idx} data-testid={`card-suggestion-${idx}`}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-base">{suggestion.name}</CardTitle>
                        {suggestion.role && <CardDescription>{suggestion.role}</CardDescription>}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingPersona(null);
                            setFormData({
                              name: suggestion.name || "",
                              role: suggestion.role || "",
                              industry: suggestion.industry || "",
                              companySize: suggestion.companySize || "",
                              painPoints: suggestion.painPoints || [],
                              goals: suggestion.goals || [],
                              objections: suggestion.objections || [],
                              preferredChannels: suggestion.preferredChannels || [],
                              notes: suggestion.notes || "",
                              isIcp: false,
                            });
                            setAiDialogOpen(false);
                            setDialogOpen(true);
                          }}
                          data-testid={`button-edit-suggestion-${idx}`}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit & Save
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleAcceptSuggestion(suggestion)}
                          data-testid={`button-accept-suggestion-${idx}`}
                        >
                          Accept
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex flex-wrap gap-2">
                      {suggestion.industry && <Badge variant="outline" className="text-xs">{suggestion.industry}</Badge>}
                      {suggestion.companySize && <Badge variant="outline" className="text-xs">{suggestion.companySize}</Badge>}
                    </div>
                    {suggestion.painPoints?.length > 0 && (
                      <div>
                        <span className="text-xs font-medium text-muted-foreground">Pain Points: </span>
                        <span className="text-xs">{suggestion.painPoints.join(", ")}</span>
                      </div>
                    )}
                    {suggestion.goals?.length > 0 && (
                      <div>
                        <span className="text-xs font-medium text-muted-foreground">Goals: </span>
                        <span className="text-xs">{suggestion.goals.join(", ")}</span>
                      </div>
                    )}
                    {suggestion.notes && (
                      <p className="text-xs text-muted-foreground">{suggestion.notes}</p>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiDialogOpen(false)} data-testid="button-close-suggestions">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import from Text Dialog */}
      <Dialog open={ingestDialogOpen} onOpenChange={setIngestDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5 text-purple-500" />
              Import Persona from Text
            </DialogTitle>
            <DialogDescription>
              Paste text from a CRM, research report, strategy doc, meeting notes, or any source describing a customer. AI will extract a structured persona.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <Textarea
              value={ingestText}
              onChange={(e) => setIngestText(e.target.value)}
              placeholder={"Paste your text here...\n\nExamples:\n- CRM contact notes or deal summaries\n- Market research reports\n- Customer interview transcripts\n- Strategy or planning documents\n- LinkedIn profile descriptions\n- Sales call notes"}
              rows={10}
              className="resize-none"
              data-testid="textarea-ingest-text"
            />
            <p className="text-xs text-muted-foreground">
              AI will analyze the text and extract name, role, industry, pain points, goals, objections, and preferred channels. You can review and edit before saving.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIngestDialogOpen(false); setIngestText(""); }} data-testid="button-cancel-ingest">
              Cancel
            </Button>
            <Button
              onClick={handleIngestText}
              disabled={ingestLoading || ingestText.trim().length < 10}
              data-testid="button-extract-persona"
            >
              {ingestLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Extract Persona
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
