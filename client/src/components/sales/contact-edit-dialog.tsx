import { useState } from "react";
import type { CampaignClassification } from "@shared/campaign-classification";
import { classificationPatchSchema } from "@shared/campaign-classification";
import type { MeetingContact } from "@shared/conference-meetings";
import type { ContactFamiliarity } from "@shared/outreach-context";
import NewProspectClassification, { type NewProspectClassificationValue } from "./new-prospect-classification";
import type { MessagingGroup } from "./use-outreach-context";
import { isValidLinkedInProfileUrl } from "@shared/linkedin-outreach";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface EditableCampaignContact {
  id: string; name: string; title: string | null; companyName: string | null; email: string | null; linkedinUrl: string | null;
  classification?: CampaignClassification | null; meeting?: MeetingContact | null;
  messagingGroup?: MessagingGroup | null; familiarity?: ContactFamiliarity;
}
export function initialContactSettings(contact: EditableCampaignContact): NewProspectClassificationValue {
  return {
    classification: {
      tags: [...contact.classification?.tags ?? []], tagsMode: "replace",
      eventRoles: [...contact.classification?.eventRoles ?? []],
      sourceDetail: contact.classification?.sourceDetail ?? "",
      meetingPriority: contact.classification?.meetingPriority ?? "normal",
      relationships: [...contact.meeting?.relationships ?? ["unknown"]],
      attendance: contact.meeting?.attendance ?? "unknown", attendanceEvidence: contact.meeting?.attendanceEvidence ?? "",
    },
    messagingGroup: contact.messagingGroup ?? null, familiarity: contact.familiarity ?? "unknown",
  };
}
/** Unlike create/import, empty reviewed settings are intentional resets, not omitted values. */
export function reviewedContactSettings(value: NewProspectClassificationValue) {
  const patch = value.classification ?? {};
  return {
    classification: classificationPatchSchema.parse({
      ...patch, tags: [...new Set((patch.tags ?? []).map(tag => tag.trim()).filter(Boolean))], tagsMode: "replace",
      eventRoles: patch.eventRoles ?? [], sourceDetail: patch.sourceDetail?.trim() ?? "",
      relationships: patch.relationships?.length ? patch.relationships : ["unknown"],
    }),
    messagingGroup: value.messagingGroup ?? null, familiarity: value.familiarity ?? "unknown",
  };
}
export default function ContactEditDialog({ contact, onClose, onSave }: {
  contact: EditableCampaignContact; onClose: () => void; onSave: (payload: object) => Promise<unknown>;
}) {
  // Parent keys by tenant/user/campaign/contact. Reopening starts a fresh review.
  const [details, setDetails] = useState(() => ({
    name: contact.name, title: contact.title ?? "", companyName: contact.companyName ?? "", email: contact.email ?? "", linkedinUrl: contact.linkedinUrl ?? "",
  }));
  const [settings, setSettings] = useState(() => initialContactSettings(contact));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Edit contact</DialogTitle><DialogDescription>Person details are shared across campaigns and used for composing and HubSpot sync. Relationships, tags, event details, messaging group and familiarity below apply to this campaign. Save them together; nothing is sent.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); if (saving) return; setError("");
        if (details.linkedinUrl.trim() && !isValidLinkedInProfileUrl(details.linkedinUrl)) { setError("Enter a valid LinkedIn person profile URL or leave it blank."); return; }
        try {
          const payload = { ...details, ...reviewedContactSettings(settings) };
          setSaving(true); await onSave(payload);
        } catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^\d+:\s*/, "") : "Could not save contact. Please retry."); }
        finally { setSaving(false); }
      }}>
        <fieldset disabled={saving} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">{([
            ["name", "Name", 300], ["title", "Title", 300], ["companyName", "Company", 300], ["email", "Email", 320], ["linkedinUrl", "LinkedIn URL", 2000],
          ] as const).map(([field, label, max]) => <label key={field} className={`space-y-1 text-sm ${field === "linkedinUrl" ? "sm:col-span-2" : ""}`}>{label}{field === "name" ? " *" : ""}
            <Input aria-label={label} required={field === "name"} type={field === "email" ? "email" : "text"} maxLength={max} value={details[field]} data-testid={`input-edit-prospect-${field === "companyName" ? "company" : field === "linkedinUrl" ? "linkedin" : field}`} onChange={event => setDetails(previous => ({ ...previous, [field]: event.target.value }))} />
          </label>)}</div>
          <NewProspectClassification mode="edit" value={settings} onChange={setSettings} />
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving || !details.name.trim()} data-testid="button-save-prospect-edit">{saving ? "Saving…" : "Save changes"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
