/**
 * Shared AI Rewrite Panel
 *
 * Used by the campaign-detail post editor and the standalone composer.
 * Sends the current draft + optional persona/framework selections to the
 * server, which assembles the system prompt from the social account's
 * voice profile. Returns N variants the user can apply.
 *
 * Design rules baked in here:
 *  - Persona dropdown defaults to "No specific audience". ICPs are listed
 *    first but selecting one is never required.
 *  - Framework picker is multi-select grouped by scope; no defaults are
 *    auto-applied on first open — the dialog pre-fills from the account's
 *    saved voice-profile defaults but every chip is removable.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, Wand2, X, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type FrameworkRefKind = "long_form" | "grounding" | "global";
export interface FrameworkRef { kind: FrameworkRefKind; id: string }

interface FrameworkItem {
  kind: FrameworkRefKind;
  id: string;
  label: string;
  scope: "market" | "tenant" | "global";
  category?: string;
}
interface PersonaRow { id: string; name: string; role?: string | null; isIcp?: boolean }
interface VoiceDefaults {
  defaultPersonaId?: string | null;
  defaultFrameworkRefs?: FrameworkRef[];
}

interface RewriteResult {
  variants: string[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  model: string;
}

interface Props {
  /** The social account whose voice profile drives the rewrite. */
  socialAccountId: string;
  /** Current draft text — the rewrite seed. */
  draft: string;
  /** When provided, the rewrite is bound to a saved post (lineage entry). */
  postId?: string;
  /** Called when the user clicks Apply on a variant. */
  onApply: (variant: string) => void;
  /** Optional className wrapper. */
  className?: string;
}

export default function AIRewritePanel({
  socialAccountId, draft, postId, onApply, className,
}: Props) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [personaId, setPersonaId] = useState<string>("__none__"); // "__none__" = no targeting
  const [frameworkRefs, setFrameworkRefs] = useState<FrameworkRef[]>([]);
  const [instructions, setInstructions] = useState("");
  const [variants, setVariants] = useState<string[] | null>(null);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Voice profile defaults — pre-fill but allow any selection (incl. none).
  const { data: voiceDefaults } = useQuery<VoiceDefaults>({
    queryKey: ["/api/social-accounts", socialAccountId, "voice-profile"],
    queryFn: async () => {
      const r = await fetch(`/api/social-accounts/${socialAccountId}/voice-profile`, { credentials: "include" });
      if (!r.ok) return {};
      return r.json();
    },
    enabled: !!socialAccountId && expanded,
  });

  const { data: personasList = [] } = useQuery<PersonaRow[]>({
    queryKey: ["/api/personas"],
    queryFn: async () => {
      const r = await fetch("/api/personas", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: expanded,
  });

  const { data: frameworksData } = useQuery<{ items: FrameworkItem[] }>({
    queryKey: ["/api/messaging-frameworks/available"],
    queryFn: async () => {
      const r = await fetch("/api/messaging-frameworks/available", { credentials: "include" });
      return r.ok ? r.json() : { items: [] };
    },
    enabled: expanded,
  });
  const frameworks = frameworksData?.items ?? [];

  // Apply voice profile defaults exactly once on first expand.
  useEffect(() => {
    if (!expanded || defaultsApplied || !voiceDefaults) return;
    if (voiceDefaults.defaultPersonaId) setPersonaId(voiceDefaults.defaultPersonaId);
    if (voiceDefaults.defaultFrameworkRefs?.length) {
      setFrameworkRefs(voiceDefaults.defaultFrameworkRefs);
    }
    setDefaultsApplied(true);
  }, [expanded, voiceDefaults, defaultsApplied]);

  const personasSorted = useMemo(() => {
    return [...personasList].sort((a, b) => {
      if (a.isIcp !== b.isIcp) return a.isIcp ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [personasList]);

  const refKey = (r: FrameworkRef) => `${r.kind}:${r.id}`;
  const selected = new Set(frameworkRefs.map(refKey));

  const groupedFrameworks: Record<string, FrameworkItem[]> = {};
  frameworks.forEach(f => {
    const key = f.scope === "global"
      ? "Brand Voice & Guidelines"
      : f.kind === "long_form" ? "Messaging Framework" : "Marketing Content";
    (groupedFrameworks[key] ??= []).push(f);
  });

  const toggleRef = (item: FrameworkItem) => {
    const k = refKey({ kind: item.kind, id: item.id });
    setFrameworkRefs(prev => {
      const has = prev.some(r => refKey(r) === k);
      return has ? prev.filter(r => refKey(r) !== k) : [...prev, { kind: item.kind, id: item.id }];
    });
  };

  const rewriteMutation = useMutation({
    mutationFn: async (): Promise<RewriteResult> => {
      const url = postId
        ? `/api/generated-posts/${postId}/rewrite`
        : `/api/posts/rewrite-preview`;
      const body: any = {
        draft,
        socialAccountId,
        personaId: personaId === "__none__" ? null : personaId,
        frameworkRefs,
        instructions: instructions.trim() || undefined,
        variantCount: 3,
      };
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Rewrite failed");
      return r.json();
    },
    onSuccess: (data) => {
      setVariants(data.variants);
    },
    onError: (err: Error) => toast({ title: "Rewrite failed", description: err.message, variant: "destructive" }),
  });

  if (!expanded) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={`gap-1 ${className ?? ""}`}
        onClick={() => setExpanded(true)}
        data-testid="ai-rewrite-toggle"
      >
        <Sparkles className="w-3.5 h-3.5" /> AI Rewrite
      </Button>
    );
  }

  return (
    <div className={`border rounded-md p-3 space-y-3 bg-muted/30 ${className ?? ""}`} data-testid="ai-rewrite-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="w-4 h-4" /> AI Rewrite
        </div>
        <Button
          type="button"
          variant="ghost" size="icon" className="h-6 w-6"
          onClick={() => { setExpanded(false); setVariants(null); }}
          data-testid="ai-rewrite-close"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Audience <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Select value={personaId} onValueChange={setPersonaId}>
            <SelectTrigger className="h-8 text-xs" data-testid="ai-rewrite-persona">
              <SelectValue placeholder="No specific audience" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No specific audience</SelectItem>
              {personasSorted.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.isIcp ? "★ " : ""}{p.name}{p.role ? ` — ${p.role}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Frameworks <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <FrameworksMiniPicker
            grouped={groupedFrameworks}
            selected={selected}
            onToggle={toggleRef}
            count={frameworkRefs.length}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Instructions <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Textarea
          rows={2}
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          placeholder="e.g., 'Lead with the stat', 'shorter and punchier', 'add a call to action'"
          className="text-xs"
          data-testid="ai-rewrite-instructions"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => { setVariants(null); rewriteMutation.mutate(); }}
          disabled={rewriteMutation.isPending || (!draft.trim() && !instructions.trim())}
          data-testid="ai-rewrite-run"
        >
          {rewriteMutation.isPending ? (
            <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Rewriting...</>
          ) : (
            <><Wand2 className="w-3.5 h-3.5 mr-1" /> Generate variants</>
          )}
        </Button>
        {!draft.trim() && !instructions.trim() && (
          <span className="text-xs text-muted-foreground">Add a draft or instructions first.</span>
        )}
      </div>

      {variants && variants.length > 0 && (
        <div className="space-y-2">
          {variants.map((v, idx) => (
            <div key={idx} className="border rounded p-2 bg-background space-y-1.5">
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-[10px]">Variant {idx + 1}</Badge>
                <Button
                  type="button" size="sm" variant="ghost" className="h-6 text-xs"
                  onClick={() => onApply(v)}
                  data-testid={`ai-rewrite-apply-${idx}`}
                >
                  Apply
                </Button>
              </div>
              <p className="text-xs whitespace-pre-wrap">{v}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FrameworksMiniPicker({
  grouped, selected, onToggle, count,
}: {
  grouped: Record<string, FrameworkItem[]>;
  selected: Set<string>;
  onToggle: (item: FrameworkItem) => void;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const total = Object.values(grouped).reduce((acc, arr) => acc + arr.length, 0);
  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline" size="sm"
        className="h-8 text-xs w-full justify-between"
        onClick={() => setOpen(o => !o)}
        disabled={total === 0}
        data-testid="ai-rewrite-frameworks-toggle"
      >
        <span className="truncate">
          {total === 0 ? "No frameworks available" : count === 0 ? "None selected" : `${count} selected`}
        </span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </Button>
      {open && total > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-popover border rounded shadow-lg p-2 space-y-2">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{group}</div>
              <div className="space-y-0.5">
                {items.map(item => {
                  const k = `${item.kind}:${item.id}`;
                  return (
                    <label
                      key={k}
                      className="flex items-center gap-2 text-xs p-1 rounded hover:bg-muted cursor-pointer"
                      data-testid={`ai-rewrite-framework-${k}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(k)}
                        onChange={() => onToggle(item)}
                      />
                      <span className="truncate">{item.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
