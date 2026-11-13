import { useState } from "react";
import { AlertCircle, Loader2, Users } from "lucide-react";
import type { MeetingContact } from "@shared/conference-meetings";
import { Button } from "@/components/ui/button";

export interface LinkedMeetingContactsProps {
  currentId: string;
  requiredIds?: string[];
  contacts: { id: string; name: string; companyName: string | null; meeting: MeetingContact }[];
  linkedIds: string[];
  onSave: (ids: string[]) => Promise<unknown>;
  disabled?: boolean;
}

function linkedIdsKey(ids: string[]) {
  return [...new Set(ids)].sort().join("\u0000");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Could not update linked contacts. Try again.";
}

function LinkedMeetingContactsForm({ currentId, requiredIds = [], contacts, linkedIds, onSave, disabled = false }: LinkedMeetingContactsProps) {
  const required = new Set([...requiredIds, currentId]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => [...new Set([...linkedIds, ...required])]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const selected = new Set(selectedIds);
  const savedLinked = new Set(linkedIds);
  const linkedContacts = contacts.filter(contact => savedLinked.has(contact.id));
  const sortedContacts = [...contacts].sort((a, b) =>
    (a.companyName ?? "").localeCompare(b.companyName ?? "") || a.name.localeCompare(b.name),
  );
  function toggleContact(id: string, checked: boolean) {
    if (required.has(id)) return;
    setSelectedIds(current => checked
      ? [...new Set([...current, id])]
      : current.filter(contactId => contactId !== id));
    setError("");
  }

  async function save() {
    if (pending || disabled) return;
    setPending(true);
    setError("");
    try {
      await onSave([...new Set([...selectedIds, ...required])]);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card" aria-label="Linked meeting contacts">
      <div className="flex items-start gap-3 border-b border-border px-3 py-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Users className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">People on this meeting</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Booking time, location, and owner are shared. Relationship notes and outreach stay separate for each person. Linking sends no invites.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Links use saved booking details; save meeting prep first when changing the booking. Linking does not update existing Outlook attendees—review invitations separately.
          </p>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Currently linked</p>
          {linkedContacts.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {linkedContacts.map(contact => (
                <li key={contact.id} className="inline-flex max-w-full items-baseline gap-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs">
                  <span className="truncate font-medium text-foreground">{contact.name}</span>
                  {contact.companyName && <span className="truncate text-muted-foreground">· {contact.companyName}</span>}
                  {contact.id === currentId && <span className="shrink-0 text-[10px] text-muted-foreground">(current)</span>}
                  {requiredIds.includes(contact.id) && contact.id !== currentId && <span className="shrink-0 text-[10px] text-muted-foreground">(original meeting contact)</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">This contact will remain on the meeting.</p>
          )}
        </div>

        <fieldset disabled={disabled || pending} className="space-y-1">
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Campaign contacts</legend>
          {sortedContacts.length ? sortedContacts.map((contact, index) => {
            const previous = sortedContacts[index - 1];
            const startsCompany = index === 0 || (contact.companyName ?? "") !== (previous?.companyName ?? "");
            return (
              <div key={contact.id}>
                {startsCompany && (
                  <p className={`${index ? "mt-2.5" : ""} mb-1 text-[11px] font-medium text-muted-foreground`}>
                    {contact.companyName || "No company listed"}
                  </p>
                )}
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-primary"
                    checked={selected.has(contact.id) || contact.id === currentId}
                    disabled={required.has(contact.id) || disabled || pending}
                    onChange={event => toggleContact(contact.id, event.target.checked)}
                    aria-label={`${contact.name}${contact.companyName ? `, ${contact.companyName}` : ""}${required.has(contact.id) ? contact.id === currentId ? ", current contact, always included" : ", original meeting contact, always included" : ""}`}
                  />
                  <span className="min-w-0 truncate text-sm text-foreground">{contact.name}</span>
                  {required.has(contact.id) && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{contact.id === currentId ? "Current" : "Original meeting contact"} · always included</span>}
                </label>
              </div>
            );
          }) : (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">No active campaign contacts are available to link.</p>
          )}
        </fieldset>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">{selectedIds.length} {selectedIds.length === 1 ? "person" : "people"} selected</p>
          <Button size="sm" onClick={save} disabled={disabled || pending}>
            {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {pending ? "Saving…" : "Save linked people"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export default function LinkedMeetingContacts(props: LinkedMeetingContactsProps) {
  return <LinkedMeetingContactsForm key={`${props.currentId}:${linkedIdsKey(props.linkedIds)}:${linkedIdsKey(props.requiredIds ?? [])}`} {...props} />;
}
