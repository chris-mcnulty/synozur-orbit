import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Trash2, MessageSquare, AtSign, UserPlus, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { MarkdownContent } from "@/components/MarkdownViewer";

export interface CollabUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

export interface Comment {
  id: string;
  threadId: string;
  authorUserId: string;
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
}

export function useCollabUsers() {
  return useQuery<{ users: CollabUser[] }>({
    queryKey: ["/api/collab/users"],
    retry: false,
  });
}

function initials(name: string | null | undefined, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function parseMentionTokens(body: string): string[] {
  // Tokens look like @[name](userId)
  const out: string[] = [];
  const re = /@\[[^\]]+\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return Array.from(new Set(out));
}

/**
 * Convert mention tokens (`@[Name](userId)`) to inline markdown links so they
 * render as styled mentions through the shared MarkdownContent renderer.
 * The MarkdownContent renderer already handles `[text](url)` as inline links,
 * so this keeps comment rendering on the app's standard markdown pipeline
 * while preserving the @mention semantics.
 */
function mentionTokensToMarkdown(body: string, users: CollabUser[]): string {
  const userMap = new Map(users.map((u) => [u.id, u]));
  return body.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, id: string) => {
    const u = userMap.get(id);
    const name = u?.name || u?.email || label;
    return `**@${name}**`;
  });
}

function CommentBody({ body, users }: { body: string; users: CollabUser[] }) {
  const md = mentionTokensToMarkdown(body, users);
  return <MarkdownContent content={md} />;
}

interface MentionTextareaProps {
  value: string;
  onChange: (v: string) => void;
  users: CollabUser[];
  placeholder?: string;
  testId?: string;
}

function MentionTextarea({ value, onChange, users, placeholder, testId }: MentionTextareaProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const handleChange = (v: string) => {
    onChange(v);
    const m = v.match(/@(\w*)$/);
    if (m) {
      setQuery(m[1].toLowerCase());
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const filtered = useMemo(
    () =>
      users
        .filter((u) =>
          (u.name || u.email).toLowerCase().includes(query),
        )
        .slice(0, 8),
    [users, query],
  );

  const insertMention = (u: CollabUser) => {
    const replaced = value.replace(/@(\w*)$/, `@[${u.name || u.email}](${u.id}) `);
    onChange(replaced);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder || "Write a comment… use @ to mention"}
        rows={3}
        data-testid={testId || "textarea-comment"}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-64 rounded-md border bg-popover p-1 shadow-md">
          {filtered.map((u) => (
            <button
              key={u.id}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(u);
              }}
              data-testid={`option-mention-${u.id}`}
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-[10px]">
                  {initials(u.name, u.email)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{u.name || u.email}</span>
              <span className="ml-auto text-xs text-muted-foreground">{u.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface CommentThreadProps {
  targetKind: string;
  targetId: string;
  /** Hide the new-comment composer (e.g., for read-only roles) */
  readOnly?: boolean;
  className?: string;
}

export function CommentThread({ targetKind, targetId, readOnly, className }: CommentThreadProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [body, setBody] = useState("");

  const usersQuery = useCollabUsers();
  const users = usersQuery.data?.users || [];

  const threadKey = ["/api/collab/threads", targetKind, targetId] as const;
  const threadQuery = useQuery<{ thread: any; comments: Comment[] }>({
    queryKey: threadKey,
    queryFn: async () => {
      const res = await fetch(`/api/collab/threads/${targetKind}/${targetId}`, {
        credentials: "include",
      });
      if (res.status === 403) {
        const err: any = new Error("Plan or role does not allow collaboration.");
        err.upgradeRequired = true;
        throw err;
      }
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    retry: false,
  });

  const post = useMutation({
    mutationFn: async (text: string) => {
      const mentions = parseMentionTokens(text);
      await apiRequest("POST", `/api/collab/threads/${targetKind}/${targetId}/comments`, {
        body: text,
        mentions,
      });
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: threadKey });
    },
    onError: (e: any) => toast({ title: "Failed to post", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/collab/comments/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: threadKey }),
  });

  if (threadQuery.isLoading) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading comments…
        </div>
      </div>
    );
  }

  if (threadQuery.isError) {
    return (
      <div className={className} data-testid="text-collab-unavailable">
        <p className="text-sm text-muted-foreground">
          Collaboration is not available on your current plan.
        </p>
      </div>
    );
  }

  const comments = threadQuery.data?.comments || [];

  return (
    <div className={className} data-testid={`comment-thread-${targetKind}-${targetId}`}>
      <div className="space-y-3">
        {comments.length === 0 && (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3" data-testid={`comment-${c.id}`}>
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">
                {initials(c.authorName, c.authorEmail)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.authorName || c.authorEmail}</span>
                <span>{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
                {c.editedAt && <span>(edited)</span>}
                <button
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate(c.id)}
                  data-testid={`button-delete-comment-${c.id}`}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1 text-sm">
                <CommentBody body={c.body} users={users} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="mt-4 space-y-2">
          <MentionTextarea
            value={body}
            onChange={setBody}
            users={users}
            testId={`textarea-comment-${targetKind}-${targetId}`}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!body.trim() || post.isPending}
              onClick={() => post.mutate(body.trim())}
              data-testid={`button-post-comment-${targetKind}-${targetId}`}
            >
              {post.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface CommentPopoverButtonProps {
  targetKind: string;
  targetId: string;
  readOnly?: boolean;
  count?: number;
}

export function CommentPopoverButton({
  targetKind,
  targetId,
  readOnly,
  count,
}: CommentPopoverButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`button-comments-${targetKind}-${targetId}`}
        >
          <MessageSquare className="mr-1 h-4 w-4" />
          Comments{typeof count === "number" && count > 0 ? ` (${count})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-h-[480px] overflow-y-auto" align="end">
        <CommentThread targetKind={targetKind} targetId={targetId} readOnly={readOnly} />
      </PopoverContent>
    </Popover>
  );
}

interface AssigneePickerProps {
  kind: "recommendation" | "feature_recommendation";
  id: string;
  value: string | null;
  readOnly?: boolean;
}

export function AssigneePicker({ kind, id, value, readOnly }: AssigneePickerProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const usersQuery = useCollabUsers();
  const users = usersQuery.data?.users || [];

  const assign = useMutation({
    mutationFn: async (userId: string | null) => {
      await apiRequest("PATCH", `/api/collab/action-items/${kind}/${id}`, {
        assignedToUserId: userId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/recommendations"] });
      qc.invalidateQueries({ queryKey: ["/api/feature-recommendations"] });
      qc.invalidateQueries({ queryKey: ["/api/action-items"] });
      qc.invalidateQueries({ queryKey: ["/api/collab/activity"] });
      toast({ title: "Assignment updated" });
    },
    onError: (e: any) =>
      toast({ title: "Failed to assign", description: e.message, variant: "destructive" }),
  });

  if (readOnly) {
    const assignee = users.find((u) => u.id === value);
    return (
      <span className="text-xs text-muted-foreground" data-testid={`text-assignee-${id}`}>
        {assignee ? assignee.name || assignee.email : "Unassigned"}
      </span>
    );
  }

  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => assign.mutate(v === "__none__" ? null : v)}
    >
      <SelectTrigger className="h-8 w-44" data-testid={`select-assignee-${id}`}>
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Unassigned</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id} data-testid={`option-assignee-${u.id}`}>
            {u.name || u.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface AnnotationRailProps {
  targetKind: string;
  targetId: string;
  readOnly?: boolean;
  className?: string;
}

interface AnnotationRow {
  id: string;
  selectedText: string | null;
  fieldPath: string | null;
  threadId: string;
  createdAt: string;
  resolvedAt: string | null;
}

export function AnnotationRail({ targetKind, targetId, readOnly, className }: AnnotationRailProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [selected, setSelected] = useState("");
  const usersQuery = useCollabUsers();
  const users = usersQuery.data?.users || [];

  const key = ["/api/collab/annotations", targetKind, targetId] as const;
  const q = useQuery<{ annotations: AnnotationRow[] }>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/collab/annotations/${targetKind}/${targetId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    retry: false,
  });

  const create = useMutation({
    mutationFn: async () => {
      const mentions = parseMentionTokens(text);
      await apiRequest("POST", `/api/collab/annotations`, {
        targetKind,
        targetId,
        selectedText: selected || null,
        body: text,
        mentions,
      });
    },
    onSuccess: () => {
      setText("");
      setSelected("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: any) =>
      toast({ title: "Failed to add annotation", description: e.message, variant: "destructive" }),
  });

  const resolve = useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      await apiRequest("PATCH", `/api/collab/annotations/${id}`, { resolved });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/collab/annotations/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const list = q.data?.annotations || [];

  return (
    <div className={className} data-testid={`annotation-rail-${targetKind}-${targetId}`}>
      <div className="mb-3 flex items-center gap-2">
        <AtSign className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Annotations</h3>
        <Badge variant="outline">{list.length}</Badge>
      </div>

      {!readOnly && (
        <div className="mb-4 space-y-2 rounded-md border p-3">
          <input
            className="w-full rounded border bg-background px-2 py-1 text-xs"
            placeholder="Quote (optional)"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            data-testid={`input-annotation-quote-${targetKind}-${targetId}`}
          />
          <MentionTextarea
            value={text}
            onChange={setText}
            users={users}
            placeholder="Add a note for the team…"
            testId={`textarea-annotation-${targetKind}-${targetId}`}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!text.trim() || create.isPending}
              onClick={() => create.mutate()}
              data-testid={`button-create-annotation-${targetKind}-${targetId}`}
            >
              Add
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {list.length === 0 && (
          <p className="text-xs text-muted-foreground">No annotations yet.</p>
        )}
        {list.map((a) => (
          <div
            key={a.id}
            className="rounded border p-2"
            data-testid={`annotation-${a.id}`}
          >
            {a.selectedText && (
              <blockquote className="mb-2 border-l-2 pl-2 text-xs italic text-muted-foreground">
                {a.selectedText}
              </blockquote>
            )}
            <CommentThread
              targetKind="annotation"
              targetId={a.id}
              readOnly={readOnly}
            />
            <div className="mt-2 flex justify-end gap-2">
              {!readOnly && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      resolve.mutate({ id: a.id, resolved: !a.resolvedAt })
                    }
                    data-testid={`button-resolve-annotation-${a.id}`}
                  >
                    {a.resolvedAt ? "Reopen" : "Resolve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(a.id)}
                    data-testid={`button-delete-annotation-${a.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { MentionTextarea };

interface OwnerAvatarProps {
  userId: string | null;
  /** Hide when no owner is assigned. */
  hideUnassigned?: boolean;
}

/**
 * Small avatar badge displaying the assigned owner of a row. Resolves the
 * user from the cached collab user list. Falls back to "Unassigned" pill
 * unless `hideUnassigned` is set.
 */
export function OwnerAvatar({ userId, hideUnassigned }: OwnerAvatarProps) {
  const usersQuery = useCollabUsers();
  const users = usersQuery.data?.users || [];
  if (!userId) {
    if (hideUnassigned) return null;
    return (
      <span
        className="text-xs text-muted-foreground"
        data-testid="text-owner-unassigned"
      >
        Unassigned
      </span>
    );
  }
  const u = users.find((x) => x.id === userId);
  const label = u?.name || u?.email || "Unknown";
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={`owner-avatar-${userId}`}>
      <Avatar className="h-5 w-5">
        <AvatarFallback className="text-[9px]">
          {initials(u?.name, u?.email)}
        </AvatarFallback>
      </Avatar>
      <span className="text-xs text-muted-foreground truncate max-w-[120px]">{label}</span>
    </span>
  );
}
