import { useState, type ReactNode } from "react";
import { Pencil, Tags, X } from "lucide-react";
import { attendanceStates, relationshipRoles } from "@shared/conference-meetings";
import { campaignEventRoles, campaignSourceLabel, classificationLabel, meetingPriorities, type ClassificationPatch } from "@shared/campaign-classification";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TableCell, TableRow } from "@/components/ui/table";
import { UNCLASSIFIED, classificationGroupLabel, classificationValues, meetingPriorityLabel, type ClassifiedPerson, type ClassificationFilters, type ClassificationGroupBy } from "./campaign-classification-helpers";

const selectClass = "h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const dimensionLabels = { meetingPriority: "Meeting priorities", relationship: "Relationships", attendance: "Attendance", eventRole: "Event roles", sourceDetail: "Source details", tag: "Tags" } as const;

export function ClassificationToolbar({ people, filters, onFiltersChange, groupBy, onGroupByChange, selectedCount, canEdit, onEdit, onClear, uniqueCount, membershipCount }: {
  people: ClassifiedPerson[]; filters: ClassificationFilters; onFiltersChange: (filters: ClassificationFilters) => void;
  groupBy: ClassificationGroupBy; onGroupByChange: (group: ClassificationGroupBy) => void;
  selectedCount: number; canEdit: boolean; onEdit: () => void; onClear: () => void; uniqueCount: number; membershipCount: number;
}) {
  return <div className="mb-3 space-y-2" data-testid="classification-toolbar">
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(dimensionLabels) as (keyof ClassificationFilters)[]).map(dimension => {
         const options = dimension === "meetingPriority" ? [...meetingPriorities] : [...new Set(people.flatMap(person => classificationValues(person, dimension)))].filter(value => value !== UNCLASSIFIED).sort();
        return <select key={dimension} aria-label={`Filter ${dimensionLabels[dimension].toLowerCase()}`} data-testid={`classification-filter-${dimension}`} className={selectClass} value={filters[dimension]} onChange={event => onFiltersChange({ ...filters, [dimension]: event.target.value })}>
          <option value="all">All {dimensionLabels[dimension].toLowerCase()}</option>
          {options.map(value => <option key={value} value={value}>{classificationGroupLabel(dimension, value)}</option>)}
           {dimension !== "meetingPriority" && <option value={UNCLASSIFIED}>Unclassified {dimensionLabels[dimension].toLowerCase()}</option>}
        </select>;
      })}
      <span className="hidden h-5 border-l md:block" />
      <select className={selectClass} aria-label="Group contacts by" data-testid="classification-group-by" value={groupBy} onChange={event => onGroupByChange(event.target.value as ClassificationGroupBy)}>
         <option value="none">No grouping</option><option value="meetingPriority">Group by meeting priority</option><option value="relationship">Group by relationship</option><option value="attendance">Group by attendance</option><option value="eventRole">Group by event role</option><option value="source">Group by source</option><option value="sourceDetail">Group by source detail</option><option value="tag">Group by tag</option>
      </select>
      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onClear} data-testid="classification-clear-filters">Clear filters</Button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span data-testid="classification-count">{uniqueCount} unique {uniqueCount === 1 ? "contact" : "contacts"}{groupBy !== "none" && <> · {membershipCount} group memberships. A contact can appear in more than one group.</>}</span>
      {canEdit ? <div className="flex items-center gap-2"><span>{selectedCount ? `${selectedCount} selected · ` : ""}Select up to 200</span><Button variant="outline" size="sm" className="h-7 text-xs" disabled={!selectedCount} onClick={onEdit} data-testid="classification-edit-selected"><Tags className="mr-1.5 h-3 w-3" />Edit selected</Button></div> : <span>Classification is read-only for your role.</span>}
    </div>
  </div>;
}

export function ClassificationBadges({ person }: { person: ClassifiedPerson }) {
  const relationships = person.meeting?.relationships?.filter(value => value !== "unknown") ?? [];
  const attendance = person.meeting?.attendance;
  const labels = [
    ...(person.classification?.meetingPriority && person.classification.meetingPriority !== "normal" ? [{ key: "meeting-priority", label: meetingPriorityLabel(person.classification.meetingPriority), title: "Meeting priority only — independent of ICP score, attendance and consent" }] : []),
    ...relationships.map(value => ({ key: `relationship-${value}`, label: classificationLabel(value), title: "Relationship" })),
    ...(attendance && attendance !== "unknown" ? [{ key: "attendance", label: attendance === "confirmed" ? "Confirmed attendee" : classificationLabel(attendance), title: person.meeting?.attendanceEvidence || "Attendance — no evidence recorded" }] : []),
    ...(person.classification?.eventRoles ?? []).map(value => ({ key: `role-${value}`, label: classificationLabel(value), title: "Event role" })),
    ...(person.classification?.tags ?? []).map(value => ({ key: `tag-${value.toLowerCase()}`, label: value, title: "Campaign tag" })),
  ];
  return <div className="mt-1 flex max-w-sm flex-wrap gap-1" data-testid={`classification-badges-${person.id}`}>
     {labels.map(item => <Badge variant="outline" data-testid={item.key === "meeting-priority" ? `meeting-priority-${person.id}` : undefined} className={`px-1.5 py-0 text-[10px] font-normal ${item.key === "meeting-priority" ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : item.key === "attendance" && attendance === "confirmed" ? "border-primary/30 bg-primary/5 text-primary" : ""}`} key={item.key} title={item.title}>{item.label}</Badge>)}
    {!labels.length && <span className="text-[10px] text-muted-foreground">Unclassified</span>}
  </div>;
}
export function ClassificationSource({ person }: { person: ClassifiedPerson }) {
  return <div><Badge variant="outline" className="text-[10px]" data-testid={`classification-source-${person.id}`}>{campaignSourceLabel(person.source)}</Badge>{person.classification?.sourceDetail && <p className="mt-1 max-w-[160px] truncate text-[10px] text-muted-foreground" title={person.classification.sourceDetail}>{person.classification.sourceDetail}</p>}</div>;
}
export function ClassificationSelect({ checked, onChange, label, disabled = false, testId }: {
  checked: boolean | "indeterminate"; onChange: (checked: boolean) => void; label: string; disabled?: boolean; testId?: string;
}) {
  return <Checkbox aria-label={label} checked={checked} disabled={disabled} onCheckedChange={value => onChange(value === true)} data-testid={testId} />;
}
export function ClassificationEditButton({ person, onEdit }: { person: ClassifiedPerson; onEdit: () => void }) {
  return <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onEdit} aria-label={`Edit classification for ${person.name || person.email || "contact"}`} data-testid={`classification-edit-${person.id}`}><Pencil className="mr-1 h-3 w-3" />Classify</Button>;
}
/** Render these rows in the EXISTING TableBody. renderPerson retains every existing table action. */
export function ClassificationRows<T extends ClassifiedPerson>({ groups, grouped, colSpan, renderPerson }: {
  groups: { key: string; label: string; people: T[] }[]; grouped: boolean; colSpan: number; renderPerson: (person: T, rowKey: string) => ReactNode;
}) {
  return <>{groups.map(group => <ClassificationRowGroup key={group.key} group={group} grouped={grouped} colSpan={colSpan} renderPerson={renderPerson} />)}</>;
}
function ClassificationRowGroup<T extends ClassifiedPerson>({ group, grouped, colSpan, renderPerson }: {
  group: { key: string; label: string; people: T[] }; grouped: boolean; colSpan: number; renderPerson: (person: T, rowKey: string) => ReactNode;
}) {
  return <>{grouped && <TableRow className="bg-muted/50 hover:bg-muted/50" data-testid={`classification-group-${group.key}`}><TableCell colSpan={colSpan} className="py-2 text-xs font-medium">{group.label}<span className="ml-2 font-normal text-muted-foreground">{group.people.length} memberships</span></TableCell></TableRow>}{group.people.map(person => renderPerson(person, `${group.key}:${person.id}`))}</>;
}

export function ClassificationEditor({ people, onClose, onSave, isSaving, error }: {
  people: ClassifiedPerson[]; onClose: () => void; onSave: (patch: ClassificationPatch) => Promise<unknown>; isSaving: boolean; error: string;
}) {
  const single = people.length === 1 ? people[0] : null;
  const [patch, setPatch] = useState<ClassificationPatch>({});
  const [tagDraft, setTagDraft] = useState("");
  const [localError, setLocalError] = useState("");
  const [tagsMode, setTagsMode] = useState<"add" | "remove" | "replace">(single ? "replace" : "add");
  const relationships = patch.relationships ?? single?.meeting?.relationships ?? ["unknown"];
  const eventRoles = patch.eventRoles ?? single?.classification?.eventRoles ?? [];
  const tags = patch.tags ?? (single ? single.classification?.tags ?? [] : []);
  const setField = <K extends keyof ClassificationPatch>(key: K, value: ClassificationPatch[K]) => setPatch(previous => ({ ...previous, [key]: value }));
  const hasField = (key: keyof ClassificationPatch) => Object.prototype.hasOwnProperty.call(patch, key);
  const toggleField = (key: keyof ClassificationPatch, initial: unknown) => setPatch(previous => {
    const next = { ...previous };
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key];
      if (key === "tags") delete next.tagsMode;
    } else Object.assign(next, { [key]: initial });
    return next;
  });
  function commitTag() {
    const incoming = tagDraft.split(",").map(tag => tag.trim()).filter(Boolean);
    if (!incoming.length) return;
    if (incoming.some(tag => tag.length > 60)) { setLocalError("Each tag must be 60 characters or fewer."); return; }
    const next = [...new Map([...tags, ...incoming].map(tag => [tag.toLowerCase(), tag])).values()];
    if (next.length > 30) { setLocalError("Use at most 30 tags."); return; }
    setPatch(previous => ({ ...previous, tags: next, tagsMode }));
    setTagDraft(""); setLocalError("");
  }
  const field = (key: keyof ClassificationPatch, label: string, initial: unknown, children: ReactNode) => <fieldset className="space-y-2 border-b pb-4 last:border-0" disabled={isSaving}>
    <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{label}</span><label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Checkbox checked={hasField(key)} onCheckedChange={() => toggleField(key, initial)} data-testid={`classification-change-${key}`} />{hasField(key) ? "Will update" : "Keep unchanged"}</label></div>
    <div className={!hasField(key) ? "opacity-60" : ""}>{children}</div>
  </fieldset>;
  return <Dialog open={people.length > 0} onOpenChange={open => { if (!open && !isSaving) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" data-testid="classification-editor">
      <DialogHeader><DialogTitle>{single ? `Classify ${single.name || single.email || "contact"}` : `Classify ${people.length} contacts`}</DialogTitle><DialogDescription>Only marked fields will change.{!single && " Relationship and event-role changes replace those lists for every selected person."} Source provenance cannot be changed.</DialogDescription></DialogHeader>
      {single && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Source: {campaignSourceLabel(single.source)} <span className="ml-1">· Read-only provenance</span></p>}
      <div className="space-y-4">
        {field("meetingPriority", "Meeting priority · independent of ICP score", single?.classification?.meetingPriority ?? "normal", <div className="space-y-2"><select className={`${selectClass} w-full`} aria-label="Meeting priority" data-testid="classification-meeting-priority" disabled={!hasField("meetingPriority")} value={patch.meetingPriority ?? single?.classification?.meetingPriority ?? "normal"} onChange={event => setField("meetingPriority", event.target.value as ClassificationPatch["meetingPriority"])}>{meetingPriorities.map(value => <option key={value} value={value}>{meetingPriorityLabel(value)}</option>)}</select><p className="text-xs text-muted-foreground">Priority does not change the score or confirm attendance, consent, or a booked meeting. Only the selected campaign contacts change.</p></div>)}
        {field("relationships", "Relationships · select all that apply", relationships, <div className="flex flex-wrap gap-1.5">{relationshipRoles.map(value => <Button key={value} type="button" size="sm" variant={relationships.includes(value) ? "secondary" : "outline"} className="h-7 px-2 text-xs" aria-pressed={relationships.includes(value)} disabled={!hasField("relationships")} data-testid={`classification-relationship-${value}`} onClick={() => {
          let next = relationships.includes(value) ? relationships.filter(role => role !== value) : [...relationships, value];
          next = value === "unknown" && !relationships.includes(value) ? ["unknown"] : next.filter(role => role !== "unknown");
          setField("relationships", next.length ? next : ["unknown"]);
        }}>{classificationLabel(value)}</Button>)}</div>)}
        {field("attendance", "Attendance", single?.meeting?.attendance ?? "unknown", <select className={`${selectClass} w-full`} aria-label="Attendance" data-testid="classification-attendance" disabled={!hasField("attendance")} value={patch.attendance ?? single?.meeting?.attendance ?? "unknown"} onChange={event => setField("attendance", event.target.value as ClassificationPatch["attendance"])}>{attendanceStates.map(value => <option value={value} key={value}>{value === "confirmed" ? "Confirmed attendee" : classificationLabel(value)}</option>)}</select>)}
        {field("attendanceEvidence", "Attendance evidence", single?.meeting?.attendanceEvidence ?? "", <Textarea aria-label="Attendance evidence" data-testid="classification-attendance-evidence" maxLength={2000} rows={2} placeholder="e.g. Confirmed by email on 12 June; registration link…" disabled={!hasField("attendanceEvidence")} value={patch.attendanceEvidence ?? single?.meeting?.attendanceEvidence ?? ""} onChange={event => setField("attendanceEvidence", event.target.value)} />)}
        {field("eventRoles", "Event roles · select all that apply", eventRoles, <div className="flex flex-wrap gap-1.5">{campaignEventRoles.map(value => <Button type="button" key={value} variant={eventRoles.includes(value) ? "secondary" : "outline"} size="sm" className="h-7 px-2 text-xs" aria-pressed={eventRoles.includes(value)} disabled={!hasField("eventRoles")} data-testid={`classification-event-role-${value}`} onClick={() => setField("eventRoles", eventRoles.includes(value) ? eventRoles.filter(role => role !== value) : [...eventRoles, value])}>{classificationLabel(value)}</Button>)}</div>)}
        {field("tags", "Campaign tags", tags, <div className="space-y-2">
          <select className={selectClass} aria-label="Tag update mode" disabled={!hasField("tags")} data-testid="classification-tags-mode" value={tagsMode} onChange={event => { const mode = event.target.value as typeof tagsMode; setTagsMode(mode); setPatch(previous => ({ ...previous, tagsMode: mode, tags: [] })); }}><option value="add">Add these tags</option><option value="remove">Remove these tags</option><option value="replace">Replace all tags</option></select>
          {tagsMode === "replace" && hasField("tags") && <p className="text-xs text-muted-foreground">Replaces all campaign tags. An empty list clears tags.</p>}
          <div className="flex flex-wrap gap-1">{tags.map(tag => <Badge key={tag.toLowerCase()} variant="secondary" className="gap-1 text-xs">{tag}<button type="button" disabled={!hasField("tags") || isSaving} aria-label={`Remove ${tag} from changes`} onClick={() => setPatch(previous => ({ ...previous, tagsMode, tags: tags.filter(value => value !== tag) }))}><X className="h-3 w-3" /></button></Badge>)}</div>
          <div className="flex gap-2"><Input aria-label="Campaign tags" className="h-8 text-xs" value={tagDraft} data-testid="classification-tags-input" disabled={!hasField("tags")} onChange={event => setTagDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitTag(); } }} placeholder="Enter tags, separated by commas" /><Button type="button" className="h-8" variant="outline" size="sm" disabled={!hasField("tags") || !tagDraft.trim()} onClick={commitTag} data-testid="classification-tags-commit">Add</Button></div>
        </div>)}
        {field("sourceDetail", "Source detail · not provenance", single?.classification?.sourceDetail ?? "", <Input maxLength={500} aria-label="Source detail" data-testid="classification-source-detail" disabled={!hasField("sourceDetail")} value={patch.sourceDetail ?? single?.classification?.sourceDetail ?? ""} onChange={event => setField("sourceDetail", event.target.value)} placeholder="e.g. From me; Referred by colleague" />)}
      </div>
      {(localError || error) && <p role="alert" className="text-sm text-destructive" data-testid="classification-error">{localError || error}</p>}
      <DialogFooter><Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button><Button disabled={isSaving || !Object.keys(patch).length} onClick={async () => { if (tagDraft.trim() && hasField("tags")) { setLocalError("Add the pending tags before saving."); return; } setLocalError(""); try { await onSave(hasField("tags") ? { ...patch, tagsMode } : patch); } catch { /* Mutation error remains visible with changes intact for retry. */ } }} data-testid="classification-save">{isSaving ? "Saving changes…" : "Save changes"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
