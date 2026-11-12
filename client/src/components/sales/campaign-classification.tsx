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
      {canEdit ? <div className="flex flex-wrap items-center gap-2"><span>{selectedCount ? `${selectedCount} selected · ` : ""}{selectedCount === 200 && uniqueCount > 200 ? "200-contact limit reached; remaining contacts are not selected." : "Select up to 200"}</span><Button variant="outline" size="sm" className="h-7 text-xs" disabled={!selectedCount} onClick={onEdit} data-testid="classification-edit-selected"><Tags className="mr-1.5 h-3 w-3" />Edit selected</Button></div> : <span>Classification is read-only for your role.</span>}
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
  const [submitting, setSubmitting] = useState(false);
  const [tagsMode, setTagsMode] = useState<"add" | "remove" | "replace">(single ? "replace" : "add");
  const busy = isSaving || submitting;
  const initial = (person: ClassifiedPerson): ClassificationPatch => ({
    meetingPriority: person.classification?.meetingPriority ?? "normal",
    relationships: person.meeting?.relationships ?? ["unknown"],
    attendance: person.meeting?.attendance ?? "unknown",
    attendanceEvidence: person.meeting?.attendanceEvidence ?? "",
    eventRoles: person.classification?.eventRoles ?? [],
    tags: person.classification?.tags ?? [],
    sourceDetail: person.classification?.sourceDetail ?? "",
  });
  const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
  const unchanged = "__unchanged";
  const baseline = single ? initial(single) : null;
  const hasField = (key: keyof ClassificationPatch) => Object.prototype.hasOwnProperty.call(patch, key);
  const resetField = (key: keyof ClassificationPatch) => {
    setPatch(previous => {
      const next = { ...previous };
      delete next[key];
      if (key === "tags") delete next.tagsMode;
      return next;
    });
    if (key === "tags") { setTagDraft(""); setLocalError(""); }
  };
  const setField = <K extends keyof ClassificationPatch>(key: K, value: ClassificationPatch[K]) => {
    setPatch(previous => {
      const next = { ...previous, [key]: value };
      // Reverting a single contact to its original value is not a change.
      if (baseline && same(value, baseline[key])) delete next[key];
      return next;
    });
  };
  const bulkLabel = (key: keyof ClassificationPatch, label: (value: string) => string = value => value || "Empty") => {
    const first = people[0] ? initial(people[0])[key] : undefined;
    return people.some(person => !same(initial(person)[key], first))
      ? "Mixed — leave unchanged"
      : `Unchanged (${Array.isArray(first) ? first.map(label).join(", ") || "Empty" : label(String(first ?? ""))})`;
  };
  const relationships = patch.relationships ?? baseline?.relationships ?? [];
  const eventRoles = patch.eventRoles ?? baseline?.eventRoles ?? [];
  const tags = patch.tags ?? (single && tagsMode === "replace" ? single.classification?.tags ?? [] : []);
  function withTags(next: string[]): ClassificationPatch {
    const result = { ...patch };
    if ((tagsMode !== "replace" && !next.length) || (baseline && tagsMode === "replace" && same(next, baseline.tags))) {
      delete result.tags; delete result.tagsMode;
    } else { result.tags = next; result.tagsMode = tagsMode; }
    return result;
  }
  function pendingTags(): string[] | null {
    const incoming = tagDraft.split(",").map(tag => tag.trim()).filter(Boolean);
    if (incoming.some(tag => tag.length > 60)) { setLocalError("Each tag must be 60 characters or fewer."); return null; }
    const next = [...new Map([...tags, ...incoming].map(tag => [tag.toLowerCase(), tag])).values()];
    if (next.length > 30) { setLocalError("Use at most 30 tags."); return null; }
    return next;
  }
  function commitTag() {
    const next = pendingTags();
    if (!next) return;
    setPatch(withTags(next));
    setTagDraft(""); setLocalError("");
  }
  const field = (key: keyof ClassificationPatch, label: string, children: ReactNode) => <fieldset className="min-w-0 space-y-1.5" disabled={busy}>
    <div className="flex min-h-5 items-center justify-between gap-2"><span className="text-xs font-medium">{label}</span>{(hasField(key) || (key === "tags" && tagDraft)) && <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => resetField(key)} aria-label={`Undo ${label}`}>Undo</button>}</div>
    {children}
  </fieldset>;
  const listMode = (key: "relationships" | "eventRoles") => !single && <select aria-label={`${key === "relationships" ? "Relationships" : "Event roles"} update mode`} className={`${selectClass} w-full`} value={hasField(key) ? "replace" : unchanged} onChange={event => event.target.value === unchanged ? resetField(key) : setField(key, key === "relationships" ? ["unknown"] : [])}>
    <option value={unchanged}>{bulkLabel(key, classificationLabel)}</option><option value="replace">Replace for all selected contacts</option>
  </select>;
  const scalar = (key: "meetingPriority" | "attendance", label: string, values: readonly string[], format: (value: string) => string) => field(key, label,
    <select className={`${selectClass} w-full`} aria-label={label} data-testid={key === "meetingPriority" ? "classification-meeting-priority" : "classification-attendance"} value={patch[key] ?? baseline?.[key] ?? unchanged} onChange={event => event.target.value === unchanged ? resetField(key) : setField(key, event.target.value as ClassificationPatch[typeof key])}>
      {!single && <option value={unchanged}>{bulkLabel(key, format)}</option>}
      {values.map(value => <option key={value} value={value}>{format(value)}</option>)}
    </select>);
  return <Dialog open={people.length > 0} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" data-testid="classification-editor">
      <DialogHeader><DialogTitle>{single ? `Classify ${single.name || single.email || "contact"}` : `Classify ${people.length} contacts`}</DialogTitle><DialogDescription>Only your changes are saved.{!single && " Replacing relationships, event roles or tags overwrites that entire list for every selected contact."}</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {scalar("meetingPriority", "Meeting priority", meetingPriorities, meetingPriorityLabel)}
          {scalar("attendance", "Attendance", attendanceStates, value => value === "confirmed" ? "Confirmed attendee" : classificationLabel(value))}
        </div>
        <p className="text-[11px] text-muted-foreground">Priority is independent of ICP score, attendance, consent and booked meetings.</p>
        {field("relationships", "Relationships", <>{listMode("relationships")}<div className="flex flex-wrap gap-1.5">{relationshipRoles.map(value => <Button key={value} type="button" size="sm" variant={relationships.includes(value) ? "secondary" : "outline"} className="h-7 px-2 text-xs" aria-pressed={relationships.includes(value)} disabled={!single && !hasField("relationships")} data-testid={`classification-relationship-${value}`} onClick={() => {
          let next = relationships.includes(value) ? relationships.filter(role => role !== value) : [...relationships, value];
          next = value === "unknown" && !relationships.includes(value) ? ["unknown"] : next.filter(role => role !== "unknown");
          setField("relationships", next.length ? next : ["unknown"]);
        }}>{classificationLabel(value)}</Button>)}</div></>)}
        {field("eventRoles", "Event roles", <>{listMode("eventRoles")}<div className="flex flex-wrap gap-1.5">{campaignEventRoles.map(value => <Button type="button" key={value} variant={eventRoles.includes(value) ? "secondary" : "outline"} size="sm" className="h-7 px-2 text-xs" aria-pressed={eventRoles.includes(value)} disabled={!single && !hasField("eventRoles")} data-testid={`classification-event-role-${value}`} onClick={() => setField("eventRoles", eventRoles.includes(value) ? eventRoles.filter(role => role !== value) : [...eventRoles, value])}>{classificationLabel(value)}</Button>)}</div></>)}
        {field("tags", "Campaign tags", <div className="space-y-2">
          <div className="flex items-center gap-2"><select className={selectClass} aria-label="Tag update mode" data-testid="classification-tags-mode" value={tagsMode} onChange={event => {
            const mode = event.target.value as typeof tagsMode;
            setTagsMode(mode);
            setPatch(previous => {
              const next = { ...previous };
              delete next.tags; delete next.tagsMode;
              if (mode === "replace" && !single) { next.tags = []; next.tagsMode = mode; }
              return next;
            });
          }}><option value="add">Add tags</option><option value="remove">Remove tags</option><option value="replace">Replace all tags</option></select>{tagsMode === "replace" && <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => { setPatch(withTags([])); setTagDraft(""); }}>Clear all tags</button>}</div>
          {!!tags.length && <div className="flex flex-wrap gap-1">{tags.map(tag => <Badge key={tag.toLowerCase()} variant="secondary" className="gap-1 text-xs">{tag}<button type="button" aria-label={`Remove ${tag} from changes`} onClick={() => setPatch(withTags(tags.filter(value => value !== tag)))}><X className="h-3 w-3" /></button></Badge>)}</div>}
          <div className="flex gap-2"><Input aria-label="Campaign tags" className="h-8 text-xs" value={tagDraft} data-testid="classification-tags-input" onChange={event => { setTagDraft(event.target.value); setLocalError(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitTag(); } }} placeholder="Tags, separated by commas" /><Button type="button" className="h-8" variant="outline" size="sm" disabled={!tagDraft.trim()} onClick={commitTag} data-testid="classification-tags-commit">Add</Button></div>
          {tagsMode === "replace" && hasField("tags") && !tags.length && <p className="text-xs text-muted-foreground">All campaign tags will be cleared.</p>}
        </div>)}
        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">Evidence & source details</summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">{single ? `Source: ${campaignSourceLabel(single.source)} · ` : ""}Source provenance is read-only.</p>
            {field("attendanceEvidence", "Attendance evidence", <><Textarea aria-label="Attendance evidence" data-testid="classification-attendance-evidence" maxLength={2000} rows={2} placeholder={single ? "Confirmation email or registration link" : bulkLabel("attendanceEvidence")} value={patch.attendanceEvidence ?? baseline?.attendanceEvidence ?? ""} onChange={event => setField("attendanceEvidence", event.target.value)} />{!single && <button type="button" className="text-xs underline underline-offset-2" onClick={() => setField("attendanceEvidence", "")}>Clear evidence for all</button>}</>)}
            {field("sourceDetail", "Source detail", <><Input maxLength={500} aria-label="Source detail" data-testid="classification-source-detail" value={patch.sourceDetail ?? baseline?.sourceDetail ?? ""} onChange={event => setField("sourceDetail", event.target.value)} placeholder={single ? "e.g. Referred by colleague" : bulkLabel("sourceDetail")} />{!single && <button type="button" className="text-xs underline underline-offset-2" onClick={() => setField("sourceDetail", "")}>Clear source detail for all</button>}</>)}
          </div>
        </details>
      </div>
      {(localError || error) && <p role="alert" className="text-sm text-destructive" data-testid="classification-error">{localError || error}</p>}
      <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button disabled={busy || (!Object.keys(patch).length && !tagDraft.trim())} onClick={async () => {
        let next = patch;
        if (tagDraft.trim()) {
          const pending = pendingTags();
          if (!pending) return;
          next = withTags(pending);
          setPatch(next); setTagDraft("");
        }
        setLocalError("");
        if (!Object.keys(next).length) return;
        setSubmitting(true);
        try { await onSave(next); } catch { setLocalError("Could not save changes. Please retry."); } finally { setSubmitting(false); }
      }} data-testid="classification-save">{busy ? "Saving changes…" : "Save changes"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
