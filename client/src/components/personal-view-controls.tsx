import { useState } from "react";
import { Bookmark, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { PersonalView, ViewAction } from "@/lib/personal-views";

interface ControlsModel<T> {
  views: PersonalView<T>[]; activeId: string | null; dirty: boolean; enabled: boolean; notice: string;
  scopeKey: string;
  dispatch: (action: ViewAction<T>) => void;
}
export function PersonalViewControls<T>({ model }: { model: ControlsModel<T> }) {
  return <PersonalViewControlBody key={model.scopeKey} model={model} />;
}
function PersonalViewControlBody<T>({ model }: { model: ControlsModel<T> }) {
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const active = model.views.find(v => v.id === model.activeId);
  function open(mode: typeof dialog) { setDialog(mode); setName(mode === "rename" ? active?.name ?? "" : ""); setError(""); }
  function act(action: ViewAction<T>) {
    // Validate errors before queuing the state update (React updaters cannot
    // safely throw into an event handler). Keep the dialog draft intact.
    if ("name" in action) {
      if (!action.name.trim()) { setError("Enter a view name."); return; }
      if (model.views.some(v => v.id !== (action.type === "rename" ? action.id : null) && v.name.toLocaleLowerCase() === action.name.trim().toLocaleLowerCase())) {
        setError("A view with this name already exists."); return;
      }
    }
    try { model.dispatch(action); setDialog(null); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "The view could not be saved."); }
  }
  return (
    <div className="space-y-1" data-testid="personal-view-controls">
      <div className="flex flex-wrap items-center gap-2">
        <Bookmark className="h-4 w-4 text-muted-foreground" aria-hidden />
        <select aria-label="Personal saved view" className="h-8 max-w-full w-44 rounded-md border bg-background px-2 text-xs" disabled={!model.enabled}
          value={model.activeId ?? ""} onChange={e => e.target.value && act({ type: "apply", id: e.target.value })}>
          <option value="">Personal views</option>
          {model.views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {model.dirty && <span className="text-xs text-muted-foreground">Modified</span>}
        <Button size="sm" variant="outline" className="h-8" disabled={!model.enabled || model.views.length >= 20} onClick={() => open("create")}>Save view</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8" disabled={!model.enabled} aria-label="Manage saved view"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!active} onClick={() => active && act({ type: "apply", id: active.id })}>Apply saved view</DropdownMenuItem>
            <DropdownMenuItem disabled={!active} onClick={() => active && act({ type: "update", id: active.id })}>Update view</DropdownMenuItem>
            <DropdownMenuItem disabled={!active} onClick={() => open("rename")}>Rename view</DropdownMenuItem>
            <DropdownMenuItem disabled={!active} onClick={() => open("delete")}>Delete view</DropdownMenuItem>
            <DropdownMenuItem onClick={() => act({ type: "reset" })}>Reset to defaults</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-[11px] text-muted-foreground">Personal · this browser only</span>
      </div>
      {model.views.length >= 20 && <p className="text-xs text-muted-foreground">20 views saved. Delete a view to save another.</p>}
      {model.notice && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{model.notice}</p>}
      <Dialog open={!!dialog} onOpenChange={open => { if (!open) setDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialog === "delete" ? "Delete saved view?" : dialog === "rename" ? "Rename saved view" : "Save personal view"}</DialogTitle>
            <DialogDescription>{dialog === "delete" ? `Remove “${active?.name}” from this browser? Your current filters will stay unchanged.` : "Saves filters and sorting for you in this browser only. No selections, editor content, or actions are saved."}</DialogDescription>
          </DialogHeader>
          {dialog !== "delete" && <Input aria-label="View name" maxLength={60} value={name} onChange={e => setName(e.target.value)} />}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={() => {
              if (dialog === "delete" && active) act({ type: "delete", id: active.id });
              else if (dialog === "rename" && active) act({ type: "rename", id: active.id, name });
              else act({ type: "create", id: crypto.randomUUID(), name });
            }}>{dialog === "delete" ? "Delete" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
