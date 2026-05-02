import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TicketIcon, Plus, ArrowLeft, Send, Clock, CheckCircle2,
  AlertCircle, MessageSquare, Edit2, X, ChevronRight
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/layout/AppLayout";
import { apiRequest } from "@/lib/queryClient";

const categoryOptions = [
  { value: "bug", label: "Bug Report" },
  { value: "feature_request", label: "Feature Request" },
  { value: "question", label: "Question" },
  { value: "feedback", label: "Feedback" },
];

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const statusColors: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  in_progress: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  waiting: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  resolved: "bg-green-500/10 text-green-400 border-green-500/30",
  closed: "bg-muted text-muted-foreground border-muted",
};

const priorityColors: Record<string, string> = {
  low: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  medium: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  urgent: "bg-red-500/10 text-red-400 border-red-500/30",
};

function NewTicketForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("question");
  const [priority, setPriority] = useState("medium");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support/tickets", { subject, description, category, priority });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      toast({ title: "Ticket submitted", description: "Your support ticket has been created." });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">New Support Ticket</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-new-ticket">
            <X size={18} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Subject</label>
          <Input
            placeholder="Brief summary of your issue"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            data-testid="input-ticket-subject"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="select-ticket-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Priority</label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger data-testid="select-ticket-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {priorityOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Description</label>
          <Textarea
            placeholder="Describe your issue in detail..."
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="input-ticket-description"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-ticket">Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!subject.trim() || !description.trim() || createMutation.isPending}
            data-testid="button-submit-ticket"
          >
            {createMutation.isPending ? "Submitting..." : "Submit Ticket"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TicketDetail({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replyMessage, setReplyMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const { data: ticket, isLoading } = useQuery({
    queryKey: ["/api/support/tickets", ticketId],
    queryFn: async () => {
      const res = await fetch(`/api/support/tickets/${ticketId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load ticket");
      return res.json();
    },
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/support/tickets/${ticketId}/replies`, { message: replyMessage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets", ticketId] });
      setReplyMessage("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/support/tickets/${ticketId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      setEditing(false);
      toast({ title: "Ticket updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="text-muted-foreground p-8 text-center">Loading ticket...</div>;
  }

  if (!ticket) {
    return <div className="text-muted-foreground p-8 text-center">Ticket not found</div>;
  }

  const startEditing = () => {
    setEditSubject(ticket.subject);
    setEditDescription(ticket.description);
    setEditing(true);
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-tickets">
        <ArrowLeft size={16} className="mr-1" /> Back to Tickets
      </Button>

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              {editing ? (
                <Input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} data-testid="input-edit-subject" />
              ) : (
                <h2 className="text-xl font-semibold" data-testid="text-ticket-subject">#{ticket.ticketNumber} - {ticket.subject}</h2>
              )}
              <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                <span>by {ticket.users?.[ticket.userId]?.name || "Unknown"}</span>
                <span>-</span>
                <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={statusColors[ticket.status] || ""}>
                {ticket.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className={priorityColors[ticket.priority] || ""}>
                {ticket.priority}
              </Badge>
              <Badge variant="outline">{ticket.category.replace("_", " ")}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {editing ? (
            <div className="space-y-4">
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={6} data-testid="input-edit-description" />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => updateMutation.mutate({ subject: editSubject, description: editDescription })} data-testid="button-save-edit">Save</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)} data-testid="button-cancel-edit">Cancel</Button>
              </div>
            </div>
          ) : (
            <div>
              <p className="whitespace-pre-wrap text-sm" data-testid="text-ticket-description">{ticket.description}</p>
              {ticket.status === "open" && (
                <div className="flex gap-2 mt-4">
                  <Button size="sm" variant="outline" onClick={startEditing} data-testid="button-edit-ticket">
                    <Edit2 size={14} className="mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ status: "closed" })} data-testid="button-close-ticket">
                    <CheckCircle2 size={14} className="mr-1" /> Close Ticket
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare size={18} />
            Replies ({ticket.replies?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          {ticket.replies?.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No replies yet</p>
          )}
          {ticket.replies?.map((reply: any) => (
            <div key={reply.id} className="border border-border rounded-lg p-4" data-testid={`reply-${reply.id}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{ticket.users?.[reply.userId]?.name || "Unknown"}</span>
                <span className="text-xs text-muted-foreground">{new Date(reply.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{reply.message}</p>
            </div>
          ))}

          {ticket.status !== "closed" && (
            <div className="flex gap-2 mt-4">
              <Textarea
                placeholder="Write a reply..."
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                rows={3}
                className="flex-1"
                data-testid="input-reply-message"
              />
              <Button
                onClick={() => replyMutation.mutate()}
                disabled={!replyMessage.trim() || replyMutation.isPending}
                className="self-end"
                data-testid="button-send-reply"
              >
                <Send size={16} />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SupportPage() {
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["/api/support/tickets"],
    queryFn: async () => {
      const res = await fetch("/api/support/tickets", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (view === "new") {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TicketIcon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Support</h1>
              <p className="text-muted-foreground text-sm">Submit a new support request</p>
            </div>
          </div>
          <NewTicketForm onClose={() => setView("list")} />
        </div>
      </AppLayout>
    );
  }

  if (view === "detail" && selectedTicketId) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TicketIcon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Support</h1>
              <p className="text-muted-foreground text-sm">Ticket details</p>
            </div>
          </div>
          <TicketDetail
            ticketId={selectedTicketId}
            onBack={() => { setView("list"); setSelectedTicketId(null); }}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TicketIcon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Support</h1>
              <p className="text-muted-foreground text-sm">Submit and track support tickets</p>
            </div>
          </div>
          <Button onClick={() => setView("new")} data-testid="button-new-ticket">
            <Plus size={16} className="mr-1" /> New Ticket
          </Button>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-lg">
              <TicketIcon size={18} className="text-primary" />
              My Tickets
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading tickets...</div>
            ) : tickets.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <TicketIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No support tickets yet</p>
                <p className="text-sm mt-1">Click "New Ticket" to submit a support request.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {tickets.map((ticket: any) => (
                  <button
                    key={ticket.id}
                    className="w-full px-6 py-4 flex items-center gap-4 hover:bg-muted/30 transition-colors text-left"
                    onClick={() => { setSelectedTicketId(ticket.id); setView("detail"); }}
                    data-testid={`ticket-row-${ticket.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">#{ticket.ticketNumber}</span>
                        <span className="font-medium truncate">{ticket.subject}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className={`text-xs ${statusColors[ticket.status] || ""}`}>
                          {ticket.status.replace("_", " ")}
                        </Badge>
                        <Badge variant="outline" className={`text-xs ${priorityColors[ticket.priority] || ""}`}>
                          {ticket.priority}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(ticket.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
