import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TicketIcon, Plus, ArrowLeft, Send, Clock, CheckCircle2,
  AlertCircle, MessageSquare, Edit2, X, ChevronRight, Paperclip, Download, Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/layout/AppLayout";
import { ObjectUploader } from "@/components/ObjectUploader";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/lib/userContext";

interface PendingAttachment {
  fileName: string;
  fileSize: number;
  contentType: string;
  objectPath: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentList({
  ticketId,
  attachments,
  users,
  canDelete,
  onDeleted,
}: {
  ticketId: string;
  attachments: any[];
  users: Record<string, { name: string }>;
  canDelete: (a: any) => boolean;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="space-y-2 mt-3">
      {attachments.map((a) => (
        <div key={a.id} className="flex items-center gap-2 p-2 border border-border rounded-md text-sm" data-testid={`attachment-${a.id}`}>
          <Paperclip size={14} className="text-muted-foreground shrink-0" />
          <a
            href={`/api/support/tickets/${ticketId}/attachments/${a.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 truncate hover:underline"
            data-testid={`attachment-link-${a.id}`}
          >
            {a.fileName}
          </a>
          <span className="text-xs text-muted-foreground shrink-0">{formatBytes(a.fileSize)}</span>
          <span className="text-xs text-muted-foreground hidden sm:inline shrink-0">
            by {users[a.uploadedBy]?.name || "Unknown"}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground"
            asChild
            data-testid={`button-download-attachment-${a.id}`}
          >
            <a href={`/api/support/tickets/${ticketId}/attachments/${a.id}`} download={a.fileName}>
              <Download size={12} />
            </a>
          </Button>
          {canDelete(a) && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive"
              data-testid={`button-delete-attachment-${a.id}`}
              onClick={async () => {
                const res = await fetch(`/api/support/tickets/${ticketId}/attachments/${a.id}`, {
                  method: "DELETE",
                  credentials: "include",
                });
                if (res.ok) {
                  toast({ title: "Attachment removed" });
                  onDeleted();
                } else {
                  toast({ title: "Error", description: "Failed to delete attachment", variant: "destructive" });
                }
              }}
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function AttachmentUploader({
  onUploaded,
  buttonLabel = "Attach file",
}: {
  onUploaded: (a: PendingAttachment) => void;
  buttonLabel?: string;
}) {
  const pendingPathRef = useRef<{ path: string; name: string; size: number; type: string } | null>(null);
  return (
    <ObjectUploader
      maxNumberOfFiles={1}
      maxFileSize={10 * 1024 * 1024}
      onGetUploadParameters={async (file) => {
        const res = await fetch("/api/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
          credentials: "include",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to get upload URL");
        }
        const { uploadURL, objectPath } = await res.json();
        pendingPathRef.current = {
          path: objectPath,
          name: file.name || "attachment",
          size: file.size || 0,
          type: file.type || "application/octet-stream",
        };
        return {
          method: "PUT" as const,
          url: uploadURL,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        };
      }}
      onComplete={(result) => {
        const file = result.successful?.[0];
        if (file && pendingPathRef.current) {
          onUploaded({
            fileName: pendingPathRef.current.name,
            fileSize: pendingPathRef.current.size,
            contentType: pendingPathRef.current.type,
            objectPath: pendingPathRef.current.path,
          });
          pendingPathRef.current = null;
        }
      }}
      buttonClassName="!bg-transparent !text-muted-foreground hover:!text-foreground !border !border-border !h-8 !px-3 !text-xs"
    >
      <Paperclip size={12} className="mr-1" /> {buttonLabel}
    </ObjectUploader>
  );
}

const categoryOptions = [
  { value: "bug", label: "Bug Report" },
  { value: "feature_request", label: "Feature Request" },
  { value: "question", label: "Question" },
  { value: "feedback", label: "Feedback" },
  { value: "account", label: "Account" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
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
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support/tickets", { subject, description, category, priority });
      const ticket = await res.json();
      // Register any pre-uploaded attachments to the new ticket
      for (const a of pendingAttachments) {
        await apiRequest("POST", `/api/support/tickets/${ticket.id}/attachments`, a);
      }
      return ticket;
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
        <div>
          <label className="text-sm font-medium mb-2 block">Attachments</label>
          {pendingAttachments.length > 0 && (
            <div className="space-y-2 mb-2">
              {pendingAttachments.map((a, i) => (
                <div key={i} className="flex items-center gap-2 p-2 border border-border rounded-md text-sm" data-testid={`pending-attachment-${i}`}>
                  <Paperclip size={14} className="text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{a.fileName}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatBytes(a.fileSize)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive"
                    onClick={() => setPendingAttachments(p => p.filter((_, idx) => idx !== i))}
                    data-testid={`button-remove-pending-${i}`}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <AttachmentUploader
            onUploaded={(a) => setPendingAttachments(p => [...p, a])}
            buttonLabel="Attach screenshot or document"
          />
          <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, TXT, or images. Max 10 MB each.</p>
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
  const { user: currentUser } = useUser();
  const adminRoles = new Set(["Global Admin", "Domain Admin"]);
  const isAdmin = currentUser ? adminRoles.has(currentUser.role) : false;
  const [replyMessage, setReplyMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [pendingReplyAttachments, setPendingReplyAttachments] = useState<PendingAttachment[]>([]);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ["/api/support/tickets", ticketId],
    queryFn: async () => {
      const res = await fetch(`/api/support/tickets/${ticketId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load ticket");
      return res.json();
    },
  });

  const refreshTicket = () => queryClient.invalidateQueries({ queryKey: ["/api/support/tickets", ticketId] });

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/support/tickets/${ticketId}/replies`, { message: replyMessage });
      const reply = await res.json();
      for (const a of pendingReplyAttachments) {
        await apiRequest("POST", `/api/support/tickets/${ticketId}/attachments`, { ...a, replyId: reply.id });
      }
      return reply;
    },
    onSuccess: () => {
      refreshTicket();
      setReplyMessage("");
      setPendingReplyAttachments([]);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const attachToTicketMutation = useMutation({
    mutationFn: async (a: PendingAttachment) => {
      const res = await apiRequest("POST", `/api/support/tickets/${ticketId}/attachments`, a);
      return res.json();
    },
    onSuccess: () => refreshTicket(),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
              {(() => {
                const ticketLevel = (ticket.attachments || []).filter((a: any) => !a.replyId);
                return (
                  <AttachmentList
                    ticketId={ticket.id}
                    attachments={ticketLevel}
                    users={ticket.users || {}}
                    canDelete={(a) => isAdmin || (a.uploadedBy === currentUser?.id && ticket.status === "open")}
                    onDeleted={refreshTicket}
                  />
                );
              })()}
              {ticket.status !== "closed" && (
                <div className="mt-3">
                  <AttachmentUploader
                    onUploaded={(a) => attachToTicketMutation.mutate(a)}
                    buttonLabel="Attach to ticket"
                  />
                </div>
              )}
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
          {ticket.replies?.map((reply: any) => {
            const replyAttachments = (ticket.attachments || []).filter((a: any) => a.replyId === reply.id);
            return (
              <div key={reply.id} className="border border-border rounded-lg p-4" data-testid={`reply-${reply.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{ticket.users?.[reply.userId]?.name || "Unknown"}</span>
                  <span className="text-xs text-muted-foreground">{new Date(reply.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{reply.message}</p>
                <AttachmentList
                  ticketId={ticket.id}
                  attachments={replyAttachments}
                  users={ticket.users || {}}
                  canDelete={(a) => isAdmin || (a.uploadedBy === currentUser?.id && ticket.status === "open")}
                  onDeleted={refreshTicket}
                />
              </div>
            );
          })}

          {ticket.status !== "closed" && (
            <div className="space-y-2 mt-4">
              <div className="flex gap-2">
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
              {pendingReplyAttachments.length > 0 && (
                <div className="space-y-2">
                  {pendingReplyAttachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 border border-border rounded-md text-sm" data-testid={`pending-reply-attachment-${i}`}>
                      <Paperclip size={14} className="text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{a.fileName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{formatBytes(a.fileSize)}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive"
                        onClick={() => setPendingReplyAttachments(p => p.filter((_, idx) => idx !== i))}
                        data-testid={`button-remove-pending-reply-${i}`}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <AttachmentUploader
                onUploaded={(a) => setPendingReplyAttachments(p => [...p, a])}
                buttonLabel="Attach to reply"
              />
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
