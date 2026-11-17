import type { ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Keep prospect entry visible regardless of the campaign page's scroll position. */
export default function NewProspectDialog({ children, canSubmit, saving, error, onSubmit, onClose }: {
  children: ReactNode; canSubmit: boolean; saving: boolean; error?: string;
  onSubmit: () => void; onClose: () => void;
}) {
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>New prospect</DialogTitle>
        <DialogDescription>Name and email are optional individually; enter at least one. Add any other details you have.</DialogDescription>
      </DialogHeader>
      <form aria-label="Add prospect" className="space-y-3" onSubmit={event => {
        event.preventDefault();
        if (canSubmit && !saving) onSubmit();
      }}>
        <fieldset disabled={saving} className="space-y-3">{children}</fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!canSubmit || saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
            {saving ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
