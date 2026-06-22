import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Send, ListPlus, Users, Ban, Trash2, Plus, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { format } from "date-fns";

interface RecipientList {
  id: string;
  name: string;
  description: string | null;
  recipientCount: number;
  createdAt: string;
}

interface Recipient {
  id: string;
  email: string;
  name: string | null;
  status: string;
  createdAt: string;
}

interface Suppression {
  id: string;
  email: string;
  reason: string;
  source: string | null;
  notes: string | null;
  createdAt: string;
}

interface EmailSend {
  id: string;
  emailId: string | null;
  subject: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  spamCount: number;
  openCount: number;
  clickCount: number;
  deliveredCount: number;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

interface EmailSendRecipient {
  id: string;
  email: string;
  name: string | null;
  status: string;
  errorMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  unsubscribedAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  openCount: number;
  clickCount: number;
  hubspotContactId: string | null;
  hsSyncStatus: string | null;
}

interface HubspotSyncSummary {
  resolved: number;
  skipped: number;
  pending: number;
  error: number;
}

interface EmailSendDetail extends EmailSend {
  recipients: EmailSendRecipient[];
  hubspotSync?: HubspotSyncSummary;
}

type SendsTab = "sends" | "lists" | "suppressions";

export default function SendsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });
  const isAllowed = tenantInfo?.features?.directEmailDelivery === true;

  const [tab, setTab] = useState<SendsTab>("sends");
  const [drilldownSendId, setDrilldownSendId] = useState<string | null>(null);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [listForm, setListForm] = useState({ name: "", description: "" });
  const [recipientsForList, setRecipientsForList] = useState<RecipientList | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [singleEmail, setSingleEmail] = useState("");
  const [singleName, setSingleName] = useState("");
  const [suppressEmail, setSuppressEmail] = useState("");

  const { data: sends = [] } = useQuery<EmailSend[]>({
    queryKey: ["/api/email-sends"],
    queryFn: async () => {
      const r = await fetch("/api/email-sends", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
    refetchInterval: 15000,
  });

  const { data: lists = [] } = useQuery<RecipientList[]>({
    queryKey: ["/api/email-recipient-lists"],
    queryFn: async () => {
      const r = await fetch("/api/email-recipient-lists", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: suppressions = [] } = useQuery<Suppression[]>({
    queryKey: ["/api/email-suppressions"],
    queryFn: async () => {
      const r = await fetch("/api/email-suppressions", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: [`/api/email-recipient-lists/${recipientsForList?.id}/recipients`],
    queryFn: async () => {
      if (!recipientsForList) return [];
      const r = await fetch(`/api/email-recipient-lists/${recipientsForList.id}/recipients`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!recipientsForList,
  });

  const createListMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/email-recipient-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(listForm),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Create failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-recipient-lists"] });
      setCreateListOpen(false);
      setListForm({ name: "", description: "" });
      toast({ title: "Recipient list created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteListMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/email-recipient-lists/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-recipient-lists"] });
      toast({ title: "List deleted" });
    },
  });

  const addRecipientsMutation = useMutation({
    mutationFn: async ({ listId, payload }: { listId: string; payload: any }) => {
      const r = await fetch(`/api/email-recipient-lists/${listId}/recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Add failed");
      return r.json() as Promise<{ inserted: number; total: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-recipient-lists"] });
      if (recipientsForList) {
        queryClient.invalidateQueries({ queryKey: [`/api/email-recipient-lists/${recipientsForList.id}/recipients`] });
      }
      setBulkText(""); setSingleEmail(""); setSingleName("");
      toast({ title: `Added ${data.inserted}`, description: `${data.total} total recipients in list` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeRecipientMutation = useMutation({
    mutationFn: async ({ listId, rid }: { listId: string; rid: string }) => {
      const r = await fetch(`/api/email-recipient-lists/${listId}/recipients/${rid}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Remove failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-recipient-lists"] });
      if (recipientsForList) {
        queryClient.invalidateQueries({ queryKey: [`/api/email-recipient-lists/${recipientsForList.id}/recipients`] });
      }
    },
  });

  const addSuppressionMutation = useMutation({
    mutationFn: async (email: string) => {
      const r = await fetch("/api/email-suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, reason: "manual" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Add failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-suppressions"] });
      setSuppressEmail("");
      toast({ title: "Suppression added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeSuppressionMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/email-suppressions/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Remove failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/email-suppressions"] }),
  });

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Email Sends</CardTitle>
              <CardDescription>Direct email delivery is available on the Enterprise plan. Send campaigns directly via SendGrid with automatic suppressions, bounce handling, and unsubscribe links.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Email Delivery">Contact Sales</a>
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
            <Send className="w-6 h-6" /> Email Sends
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Track campaign deliveries, manage recipient lists, and review suppressions.</p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as SendsTab)}>
          <TabsList>
            <TabsTrigger value="sends" data-testid="tab-sends"><Send className="w-3.5 h-3.5 mr-1.5" />Sends ({sends.length})</TabsTrigger>
            <TabsTrigger value="lists" data-testid="tab-lists"><Users className="w-3.5 h-3.5 mr-1.5" />Recipient Lists ({lists.length})</TabsTrigger>
            <TabsTrigger value="suppressions" data-testid="tab-suppressions"><Ban className="w-3.5 h-3.5 mr-1.5" />Suppressions ({suppressions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="sends" className="space-y-3 mt-4">
            {sends.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="text-no-sends">No email sends yet. Send a generated email from the Email Newsletters page.</CardContent></Card>
            ) : sends.map(s => (
              <Card
                key={s.id}
                data-testid={`card-send-${s.id}`}
                className="cursor-pointer hover:bg-accent/40 transition-colors"
                onClick={() => setDrilldownSendId(s.id)}
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate" data-testid={`text-send-subject-${s.id}`}>{s.subject}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(s.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        {s.status === "queued" && s.scheduledAt && (
                          <> · scheduled {format(new Date(s.scheduledAt), "MMM d, h:mm a")}</>
                        )}
                      </p>
                      {s.errorMessage && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{s.errorMessage}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <Badge variant={s.status === "completed" ? "default" : s.status === "failed" ? "destructive" : "secondary"} className="capitalize">{s.status.replace(/_/g, " ")}</Badge>
                      <Badge variant="outline" className="text-[10px]" data-testid={`badge-sent-${s.id}`}>{s.sentCount}/{s.totalRecipients} sent</Badge>
                      {s.deliveredCount > 0 && <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300" data-testid={`badge-delivered-${s.id}`}>{s.deliveredCount} delivered</Badge>}
                      {s.openCount > 0 && <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300" data-testid={`badge-opens-${s.id}`}>{s.openCount} opens</Badge>}
                      {s.clickCount > 0 && <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-300" data-testid={`badge-clicks-${s.id}`}>{s.clickCount} clicks</Badge>}
                      {s.bounceCount > 0 && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">{s.bounceCount} bounced</Badge>}
                      {s.unsubscribeCount > 0 && <Badge variant="outline" className="text-[10px]">{s.unsubscribeCount} unsub</Badge>}
                      {s.spamCount > 0 && <Badge variant="outline" className="text-[10px] text-red-600 border-red-300">{s.spamCount} spam</Badge>}
                      {s.failedCount > 0 && <Badge variant="outline" className="text-[10px] text-red-600 border-red-300">{s.failedCount} failed</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="lists" className="space-y-3 mt-4">
            <div className="flex justify-end">
              <Button onClick={() => setCreateListOpen(true)} data-testid="button-new-list"><Plus className="w-4 h-4 mr-1" />New list</Button>
            </div>
            {lists.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="text-no-lists">No recipient lists yet.</CardContent></Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {lists.map(l => (
                  <Card key={l.id} data-testid={`card-list-${l.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{l.name}</CardTitle>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive shrink-0"
                          onClick={() => deleteListMutation.mutate(l.id)}
                          data-testid={`button-delete-list-${l.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {l.description && <CardDescription>{l.description}</CardDescription>}
                    </CardHeader>
                    <CardContent className="pt-0 flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{l.recipientCount} recipient{l.recipientCount !== 1 ? "s" : ""}</span>
                      <Button variant="outline" size="sm" onClick={() => setRecipientsForList(l)} data-testid={`button-manage-list-${l.id}`}>
                        <ListPlus className="w-3.5 h-3.5 mr-1" />Manage
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="suppressions" className="space-y-3 mt-4">
            <Card>
              <CardContent className="py-4 flex gap-2">
                <Input
                  placeholder="email@example.com"
                  value={suppressEmail}
                  onChange={e => setSuppressEmail(e.target.value)}
                  data-testid="input-suppress-email"
                />
                <Button
                  onClick={() => addSuppressionMutation.mutate(suppressEmail)}
                  disabled={!suppressEmail.includes("@") || addSuppressionMutation.isPending}
                  data-testid="button-add-suppression"
                >
                  Suppress
                </Button>
              </CardContent>
            </Card>
            {suppressions.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="text-no-suppressions">No suppressions. Bounces and unsubscribes will be added here automatically.</CardContent></Card>
            ) : (
              <div className="grid gap-2">
                {suppressions.map(s => (
                  <Card key={s.id} data-testid={`card-suppression-${s.id}`}>
                    <CardContent className="py-3 flex items-center gap-3">
                      <Ban className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="font-mono text-sm flex-1 truncate">{s.email}</span>
                      <Badge variant="outline" className="capitalize text-[10px]">{s.reason}</Badge>
                      {s.source && <span className="text-[10px] text-muted-foreground">{s.source}</span>}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeSuppressionMutation.mutate(s.id)} data-testid={`button-remove-suppression-${s.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={createListOpen} onOpenChange={setCreateListOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>New recipient list</DialogTitle>
              <DialogDescription>Create a list to send emails to. You can add recipients in bulk afterwards.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={listForm.name} onChange={e => setListForm(f => ({ ...f, name: e.target.value }))} data-testid="input-list-name" />
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input value={listForm.description} onChange={e => setListForm(f => ({ ...f, description: e.target.value }))} data-testid="input-list-description" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setCreateListOpen(false)}>Cancel</Button>
                <Button
                  disabled={!listForm.name.trim() || createListMutation.isPending}
                  onClick={() => createListMutation.mutate()}
                  data-testid="button-confirm-create-list"
                >
                  {createListMutation.isPending ? "Creating..." : "Create"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!recipientsForList} onOpenChange={v => { if (!v) setRecipientsForList(null); }}>
          <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{recipientsForList?.name}</DialogTitle>
              <DialogDescription>Manage the recipients in this list.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Add a single recipient</CardTitle></CardHeader>
                <CardContent className="flex gap-2">
                  <Input placeholder="email@example.com" value={singleEmail} onChange={e => setSingleEmail(e.target.value)} data-testid="input-single-email" />
                  <Input placeholder="Name (optional)" value={singleName} onChange={e => setSingleName(e.target.value)} data-testid="input-single-name" />
                  <Button
                    disabled={!singleEmail.includes("@") || addRecipientsMutation.isPending}
                    onClick={() => recipientsForList && addRecipientsMutation.mutate({ listId: recipientsForList.id, payload: { email: singleEmail, name: singleName } })}
                    data-testid="button-add-single"
                  >Add</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Bulk add (one per line: email,name)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Textarea rows={5} value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder="alice@example.com,Alice&#10;bob@example.com,Bob" data-testid="input-bulk-text" />
                  <Button
                    disabled={!bulkText.trim() || addRecipientsMutation.isPending}
                    onClick={() => recipientsForList && addRecipientsMutation.mutate({ listId: recipientsForList.id, payload: { bulkText } })}
                    data-testid="button-add-bulk"
                  >Add bulk</Button>
                </CardContent>
              </Card>
              <div>
                <h4 className="text-sm font-medium mb-2">Recipients ({recipients.length})</h4>
                <div className="border rounded-lg max-h-72 overflow-y-auto divide-y">
                  {recipients.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground text-center">No recipients yet.</p>
                  ) : recipients.map(r => (
                    <div key={r.id} className="px-3 py-2 flex items-center gap-2 text-sm" data-testid={`row-recipient-${r.id}`}>
                      <span className="font-mono flex-1 truncate">{r.email}</span>
                      {r.name && <span className="text-muted-foreground text-xs">{r.name}</span>}
                      <Badge variant="outline" className="text-[10px] capitalize">{r.status}</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => recipientsForList && removeRecipientMutation.mutate({ listId: recipientsForList.id, rid: r.id })}
                        data-testid={`button-remove-recipient-${r.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <SendDrilldownDialog
          sendId={drilldownSendId}
          open={!!drilldownSendId}
          onOpenChange={(o) => { if (!o) setDrilldownSendId(null); }}
        />
      </div>
    </AppLayout>
  );
}

function SendDrilldownDialog({ sendId, open, onOpenChange }: { sendId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading } = useQuery<EmailSendDetail>({
    queryKey: [`/api/email-sends/${sendId}`],
    queryFn: async () => {
      const r = await fetch(`/api/email-sends/${sendId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load send");
      return r.json();
    },
    enabled: !!sendId && open,
    refetchInterval: open ? 15000 : false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-drilldown-subject">{data?.subject ?? "Send details"}</DialogTitle>
          <DialogDescription>
            {data ? (
              <>
                {format(new Date(data.createdAt), "MMM d, yyyy 'at' h:mm a")}
                {" · "}
                {data.totalRecipients} recipient{data.totalRecipients !== 1 ? "s" : ""}
                {" · status "}
                <span className="capitalize">{data.status.replace(/_/g, " ")}</span>
              </>
            ) : "Loading..."}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              <SendStat label="Sent" value={data.sentCount} testid={`stat-sent-${data.id}`} />
              <SendStat label="Delivered" value={data.deliveredCount} testid={`stat-delivered-${data.id}`} />
              <SendStat label="Opens" value={data.openCount} testid={`stat-opens-${data.id}`} />
              <SendStat label="Clicks" value={data.clickCount} testid={`stat-clicks-${data.id}`} />
              <SendStat label="Bounced" value={data.bounceCount} testid={`stat-bounced-${data.id}`} />
              <SendStat label="Spam" value={data.spamCount} testid={`stat-spam-${data.id}`} />
              <SendStat label="Unsub" value={data.unsubscribeCount} testid={`stat-unsub-${data.id}`} />
              <SendStat label="Failed" value={data.failedCount} testid={`stat-failed-${data.id}`} />
            </div>
            {data.hubspotSync && (data.hubspotSync.resolved + data.hubspotSync.skipped + data.hubspotSync.error > 0) && (
              <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="hubspot-sync-summary">
                <span className="text-muted-foreground">HubSpot sync:</span>
                <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">{data.hubspotSync.resolved} synced</Badge>
                {data.hubspotSync.skipped > 0 && <Badge variant="outline" className="text-[10px] text-muted-foreground">{data.hubspotSync.skipped} unmatched</Badge>}
                {data.hubspotSync.pending > 0 && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">{data.hubspotSync.pending} pending</Badge>}
                {data.hubspotSync.error > 0 && <Badge variant="outline" className="text-[10px] text-red-600 border-red-300">{data.hubspotSync.error} errors</Badge>}
              </div>
            )}
            <div>
              <h4 className="text-sm font-medium mb-2">Recipients ({data.recipients.length})</h4>
              <div className="border rounded-lg max-h-[420px] overflow-y-auto divide-y">
                {data.recipients.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground text-center" data-testid="text-drilldown-no-recipients">No recipients have been queued yet.</p>
                ) : data.recipients.map((r) => (
                  <div key={r.id} className="px-3 py-2 flex items-center gap-2 text-sm" data-testid={`row-drilldown-recipient-${r.id}`}>
                    <span className="font-mono flex-1 truncate">{r.email}</span>
                    {r.name && <span className="text-muted-foreground text-xs truncate max-w-[120px]">{r.name}</span>}
                    <Badge variant="outline" className="text-[10px] capitalize">{r.status}</Badge>
                    {r.openCount > 0 && <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">{r.openCount} open{r.openCount !== 1 ? "s" : ""}</Badge>}
                    {r.clickCount > 0 && <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-300">{r.clickCount} click{r.clickCount !== 1 ? "s" : ""}</Badge>}
                    {r.hsSyncStatus === "resolved" && <Badge variant="outline" className="text-[10px] text-green-600 border-green-300" title={r.hubspotContactId ? `HubSpot contact ${r.hubspotContactId}` : undefined}>HubSpot</Badge>}
                    {r.hsSyncStatus === "skipped" && <Badge variant="outline" className="text-[10px] text-muted-foreground">no HS contact</Badge>}
                    {r.hsSyncStatus === "error" && <Badge variant="outline" className="text-[10px] text-red-600 border-red-300">HS sync error</Badge>}
                    {r.errorMessage && <span className="text-[10px] text-amber-600 truncate max-w-[200px]" title={r.errorMessage}>{r.errorMessage}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SendStat({ label, value, testid }: { label: string; value: number; testid: string }) {
  return (
    <div className="border rounded-md p-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums" data-testid={testid}>{value}</p>
    </div>
  );
}
