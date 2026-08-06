/**
 * Settings → Integrations card for the Synozur website (www) MCP connection.
 * Admins paste the MCP endpoint + an mcp.write key; once connected, Orbit can
 * push blog drafts straight to the Insights site. The key is write-only — it's
 * never returned by the API after saving.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Globe, Loader2, CheckCircle2, AlertCircle, Plug, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_ENDPOINT = "https://synozur-baseline.replit.app/api/mcp";

interface Status {
  connected: boolean;
  endpoint?: string;
  defaultAuthorId?: string | null;
  lastUsedAt?: string | null;
  lastError?: string | null;
}
interface Author { id: string; displayName: string }

export function WebsiteIntegrationCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);

  const { data: status, isLoading } = useQuery<Status>({
    queryKey: ["/api/integrations/website/status"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/website/status", { credentials: "include" });
      return r.ok ? r.json() : { connected: false };
    },
  });

  // Authors are only fetchable once connected; used to pick a default author.
  const { data: authors = [] } = useQuery<Author[]>({
    queryKey: ["/api/integrations/website/authors"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/website/authors", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!status?.connected,
  });

  const connect = useMutation({
    mutationFn: async (body: { endpoint: string; apiKey?: string; defaultAuthorId?: string | null }) => {
      const r = await fetch("/api/integrations/website/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Connect failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/website/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/website/authors"] });
      setApiKey("");
      setEditing(false);
      toast({ title: "Website connected", description: "Orbit can now post blog drafts to the Insights site." });
    },
    onError: (e: Error) => toast({ title: "Couldn't connect", description: e.message, variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/integrations/website/disconnect", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Disconnect failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/website/status"] });
      toast({ title: "Website disconnected" });
    },
    onError: (e: Error) => toast({ title: "Couldn't disconnect", description: e.message, variant: "destructive" }),
  });

  const showForm = !status?.connected || editing;

  return (
    <Card data-testid="card-website-integration">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="w-4 h-4 text-primary" /> Synozur Website
            </CardTitle>
            <CardDescription>Publish blog drafts straight to the Insights site via its MCP server.</CardDescription>
          </div>
          {status?.connected && (
            <Badge className="bg-emerald-600/90 text-primary-foreground text-[10px] gap-1 shrink-0">
              <CheckCircle2 className="w-3 h-3" /> Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : showForm ? (
          <>
            <div>
              <Label className="text-xs text-muted-foreground">MCP endpoint</Label>
              <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder={DEFAULT_ENDPOINT} data-testid="input-website-endpoint" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">MCP key (mcp.write)</Label>
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="syn_…" data-testid="input-website-key" />
              <p className="text-[11px] text-muted-foreground mt-1">A key with <code>mcp.write</code> is required to create drafts. Stored encrypted; never shown again.</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => connect.mutate({ endpoint, apiKey: apiKey || undefined })}
                disabled={connect.isPending || !endpoint || (!status?.connected && !apiKey)}
                data-testid="button-website-connect"
              >
                {connect.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plug className="w-3.5 h-3.5 mr-1.5" />}
                {status?.connected ? "Save" : "Connect & test"}
              </Button>
              {editing && <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setApiKey(""); }}>Cancel</Button>}
            </div>
          </>
        ) : (
          <>
            <div className="text-sm text-muted-foreground break-all">{status?.endpoint}</div>
            {/* Last-used timestamp — always shown when connected */}
            {status?.lastUsedAt && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3 shrink-0" />
                Last used {formatDistanceToNow(new Date(status.lastUsedAt), { addSuffix: true })}
              </p>
            )}
            {/* Error banner — shown when the most recent MCP call failed */}
            {status?.lastError && (
              <div className="rounded-md border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-0.5">
                  <p className="font-medium">Last call failed</p>
                  <p className="text-amber-700 dark:text-amber-400 break-all">{status.lastError}</p>
                  <p className="text-amber-600/70 dark:text-amber-500/70 mt-1">This clears automatically on the next successful call. If the error persists, rotate the MCP key.</p>
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground">Default author for new drafts</Label>
              <Select
                value={status?.defaultAuthorId ?? "none"}
                onValueChange={(v) => connect.mutate({ endpoint: status!.endpoint!, defaultAuthorId: v === "none" ? null : v })}
              >
                <SelectTrigger className="mt-1" data-testid="select-website-default-author"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No default (choose each time)</SelectItem>
                  {authors.map((a) => <SelectItem key={a.id} value={a.id}>{a.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setEndpoint(status?.endpoint ?? DEFAULT_ENDPOINT); setEditing(true); }} data-testid="button-website-edit">Rotate key</Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} data-testid="button-website-disconnect">Disconnect</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default WebsiteIntegrationCard;
