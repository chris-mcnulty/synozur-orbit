import { attendanceStates, relationshipRoles } from "@shared/conference-meetings";
import { campaignEventRoles, classificationLabel, meetingPriorities, classificationPatchSchema, type ClassificationPatch } from "@shared/campaign-classification";
import { messagingGroups, messagingGroupLabels, contactFamiliarities, familiarityLabels, type ContactFamiliarity } from "@shared/outreach-context";
import type { MessagingGroup } from "./use-outreach-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export interface NewProspectClassificationValue {
  classification?: ClassificationPatch;
  messagingGroup?: MessagingGroup | null;
  familiarity?: ContactFamiliarity;
}

/** Empty controls are omitted, not sent as resets when a contact already exists. */
export function newProspectClassificationPayload(value: NewProspectClassificationValue): NewProspectClassificationValue {
  const patch = { ...value.classification };
  if (patch.tags) patch.tags = [...new Set(patch.tags.map(tag => tag.trim()).filter(Boolean))];
  if (!patch.relationships?.length) delete patch.relationships;
  if (!patch.eventRoles?.length) delete patch.eventRoles;
  if (!patch.tags?.length) { delete patch.tags; delete patch.tagsMode; }
  if (!patch.sourceDetail?.trim()) delete patch.sourceDetail;
  return {
    ...(Object.keys(patch).length ? { classification: classificationPatchSchema.parse(patch) } : {}),
    ...(value.messagingGroup !== undefined ? { messagingGroup: value.messagingGroup } : {}),
    ...(value.familiarity !== undefined ? { familiarity: value.familiarity } : {}),
  };
}

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
export default function NewProspectClassification({ value, onChange, mode = "create", relationshipLabels }: {
  value: NewProspectClassificationValue; onChange: (value: NewProspectClassificationValue) => void; mode?: "create" | "edit";
  relationshipLabels?: Partial<Record<(typeof relationshipRoles)[number], string>>;
}) {
  const patch = value.classification ?? {};
  function field<K extends keyof ClassificationPatch>(key: K, next: ClassificationPatch[K]) {
    const updated = { ...patch, [key]: next };
    if (next === undefined) delete updated[key];
    onChange({ ...value, classification: updated });
  }
  return <section className="space-y-3 border-t pt-3" aria-label={mode === "edit" ? "Campaign contact settings" : "New contact classification"}>
    <fieldset className="space-y-2"><legend className="text-sm font-medium">Relationships (optional)</legend>
      <div className="flex flex-wrap gap-1.5">{relationshipRoles.map(role => <Button key={role} type="button" size="sm" className="h-7 px-2 text-xs" variant={patch.relationships?.includes(role) ? "secondary" : "outline"} aria-pressed={patch.relationships?.includes(role) ?? false} onClick={() => {
        const current = patch.relationships ?? [];
        const next = current.includes(role) ? current.filter(item => item !== role) : role === "unknown" ? [role] : [...current.filter(item => item !== "unknown"), role];
        field("relationships", next);
      }}>{relationshipLabels?.[role] ?? classificationLabel(role)}</Button>)}</div>
    </fieldset>
    <label className="flex items-start gap-2 text-sm"><Checkbox className="mt-0.5" checked={value.familiarity === "personal_friend"} onCheckedChange={checked => onChange({ ...value, familiarity: checked ? "personal_friend" : "unknown" })} /><span>Personal friendship<span className="mt-0.5 block text-xs text-muted-foreground">Explicitly a friend of the campaign sender. Drafts can be warm and less formal; this never implies consent. A “personal” tag alone does not mean friendship. Unchecking resets familiarity to Unknown; choose Known contact separately if appropriate.</span></span></label>
    <label className="block space-y-1 text-sm">Campaign tags (optional)
      <Input aria-label={mode === "edit" ? "Campaign tags" : "New prospect tags"} placeholder="Comma-separated tags" value={(patch.tags ?? []).join(",")} onChange={event => field("tags", event.target.value.split(",").map(tag => tag.trimStart()))} />
    </label>
    <details className="rounded-md border px-3 py-2"><summary className="cursor-pointer text-sm font-medium">Event, messaging & source details</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Attendance<select className={selectClass} value={patch.attendance ?? ""} onChange={event => field("attendance", (event.target.value || undefined) as ClassificationPatch["attendance"])}>{mode === "create" && <option value="">Leave unchanged</option>}{attendanceStates.map(item => <option key={item} value={item}>{classificationLabel(item)}</option>)}</select></label>
        <label className="space-y-1 text-sm">Meeting priority<select className={selectClass} value={patch.meetingPriority ?? ""} onChange={event => field("meetingPriority", (event.target.value || undefined) as ClassificationPatch["meetingPriority"])}>{mode === "create" && <option value="">Leave unchanged</option>}{meetingPriorities.map(item => <option key={item} value={item}>{classificationLabel(item)}</option>)}</select></label>
        <label className="space-y-1 text-sm">Messaging group<select className={selectClass} value={value.messagingGroup ?? ""} onChange={event => onChange({ ...value, messagingGroup: (event.target.value || (mode === "edit" ? null : undefined)) as MessagingGroup | null | undefined })}><option value="">{mode === "edit" ? "Shared campaign brief / no group" : "Leave unchanged"}</option>{messagingGroups.map(item => <option key={item} value={item}>{messagingGroupLabels[item]}</option>)}</select></label>
        <label className="space-y-1 text-sm">Familiarity<select className={selectClass} value={value.familiarity ?? ""} onChange={event => onChange({ ...value, familiarity: (event.target.value || undefined) as ContactFamiliarity | undefined })}>{mode === "create" && <option value="">Leave unchanged</option>}{contactFamiliarities.map(item => <option key={item} value={item}>{familiarityLabels[item]}</option>)}</select></label>
        <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm">Event roles</legend><div className="flex flex-wrap gap-1.5">{campaignEventRoles.map(role => <Button key={role} type="button" size="sm" className="h-7 px-2 text-xs" variant={patch.eventRoles?.includes(role) ? "secondary" : "outline"} aria-pressed={patch.eventRoles?.includes(role) ?? false} onClick={() => field("eventRoles", patch.eventRoles?.includes(role) ? patch.eventRoles.filter(item => item !== role) : [...patch.eventRoles ?? [], role])}>{classificationLabel(role)}</Button>)}</div></fieldset>
        <label className="space-y-1 text-sm sm:col-span-2">Source detail<Input maxLength={500} value={patch.sourceDetail ?? ""} onChange={event => field("sourceDetail", event.target.value)} placeholder="For example, introduced by a colleague" /></label>
        {mode === "edit" && <label className="space-y-1 text-sm sm:col-span-2">Attendance evidence<Input maxLength={2000} value={patch.attendanceEvidence ?? ""} onChange={event => field("attendanceEvidence", event.target.value)} placeholder="Confirmation email or registration link" /></label>}
      </div>
    </details>
    <p className="text-xs text-muted-foreground">{mode === "edit" ? "All reviewed campaign settings are saved together with contact details. Empty tags, event roles and source details clear their previous values; no selected relationship means Unknown." : "Optional fields are saved only when supplied. Existing contact details are not reset."}</p>
  </section>;
}
