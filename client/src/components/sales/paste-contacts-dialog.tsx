import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isValidLinkedInProfileUrl } from "@shared/linkedin-outreach";

export interface ParsedContact {
  name: string;
  title: string;
  companyName: string;
  email: string;
  linkedinUrl: string;
}

interface ParseResponse {
  contacts: { name?: string; title?: string | null; companyName?: string | null; email?: string | null; linkedinUrl?: string | null }[];
  warnings: string[];
}

interface PasteContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onImport: (contacts: ParsedContact[]) => Promise<void>;
  heading?: string;
  requireEmailOrLinkedin?: boolean;
}

const MAX_TEXT_LENGTH = 30000;
const MAX_CONTACTS = 100;

function contactIssue(contact: ParsedContact, requireIdentity: boolean) {
  if (!contact.name.trim()) return "Add a name before importing this contact.";
  if (contact.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) return "Enter a valid email address or leave it blank.";
  if (contact.linkedinUrl.trim() && !isValidLinkedInProfileUrl(contact.linkedinUrl)) return "Enter a valid LinkedIn person profile URL or leave it blank.";
  if (requireIdentity && !contact.email.trim() && !contact.linkedinUrl.trim()) return "Add an email address or LinkedIn profile before importing this event contact.";
  return "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Could not parse contacts. Try again.";
}

export default function PasteContactsDialog({
  open,
  onOpenChange,
  campaignId,
  onImport,
  heading = "Paste contacts",
  requireEmailOrLinkedin = false,
}: PasteContactsDialogProps) {
  const [text, setText] = useState("");
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [parsed, setParsed] = useState(false);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [imported, setImported] = useState(false);
  const requestId = useRef(0);
  const latestText = useRef(text);

  useEffect(() => {
    if (!open) return;
    requestId.current += 1;
    latestText.current = "";
    setText("");
    setContacts([]);
    setWarnings([]);
    setSelected(new Set());
    setParsed(false);
    setPending(false);
    setImporting(false);
    setError("");
    setImportError("");
    setImported(false);
  }, [open]);

  function changeText(value: string) {
    latestText.current = value;
    setText(value);
    requestId.current += 1;
    setContacts([]);
    setWarnings([]);
    setSelected(new Set());
    setParsed(false);
    setPending(false);
    setError("");
    setImportError("");
    setImported(false);
  }

  async function parse() {
    if (!text.trim() || text.length > MAX_TEXT_LENGTH || pending) return;
    const currentRequest = ++requestId.current;
    const source = text;
    setContacts([]);
    setWarnings([]);
    setSelected(new Set());
    setParsed(false);
    setError("");
    setImportError("");
    setImported(false);
    setPending(true);
    try {
      const response = await apiRequest("POST", `/api/sales-outreach/campaigns/${campaignId}/parse-contacts`, { text: source });
      const result = await response.json() as ParseResponse;
      if (requestId.current !== currentRequest || latestText.current !== source) return;
      const returnedContacts = Array.isArray(result.contacts) ? result.contacts : [];
      const rows = returnedContacts
        .slice(0, MAX_CONTACTS).map((contact) => ({
          name: String(contact.name ?? "").trim(),
          title: String(contact.title ?? "").trim(),
          companyName: String(contact.companyName ?? "").trim(),
          email: String(contact.email ?? "").trim(),
          linkedinUrl: String(contact.linkedinUrl ?? "").trim(),
        })).filter((contact) => contact.name);
      setContacts(rows);
      const notes = Array.isArray(result.warnings) ? result.warnings.map(String) : [];
      if (returnedContacts.length > MAX_CONTACTS) notes.push(`Only the first ${MAX_CONTACTS} contacts can be reviewed in one import.`);
      setWarnings(notes);
      setSelected(new Set(rows.map((contact, index) => ({ contact, index }))
        .filter(({ contact }) => !contactIssue(contact, requireEmailOrLinkedin))
        .map(({ index }) => index)));
      setParsed(true);
    } catch (cause) {
      if (requestId.current === currentRequest && latestText.current === source) setError(errorMessage(cause));
    } finally {
      if (requestId.current === currentRequest) setPending(false);
    }
  }

  function updateContact(index: number, field: keyof ParsedContact, value: string) {
    const updated = { ...contacts[index], [field]: value };
    setContacts((current) => current.map((contact, i) => i === index ? updated : contact));
    if (contactIssue(updated, requireEmailOrLinkedin)) {
      setSelected((current) => {
        const next = new Set(current);
        next.delete(index);
        return next;
      });
    }
  }

  async function importSelected() {
    const rows = contacts.filter((contact, index) => selected.has(index) && !contactIssue(contact, requireEmailOrLinkedin));
    if (!rows.length || importing) return;
    setImporting(true);
    setImportError("");
    try {
      await onImport(rows);
      setImported(true);
    } catch (cause) {
      setImportError(errorMessage(cause));
    } finally {
      setImporting(false);
    }
  }

  const selectableIndices = contacts.map((contact, index) => ({ contact, index }))
    .filter(({ contact }) => !contactIssue(contact, requireEmailOrLinkedin))
    .map(({ index }) => index);
  const allSelectableSelected = selectableIndices.length > 0 && selectableIndices.every((index) => selected.has(index));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !pending && !importing) onOpenChange(false); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />{heading}</DialogTitle>
          <DialogDescription>Paste notes, copied profiles, or a rough contact list. Review every extracted field before adding anyone to this campaign. Nothing is imported until you confirm.</DialogDescription>
        </DialogHeader>
        {imported ? (
          <div className="py-8 text-center">
            <p role="status" className="text-lg font-semibold">Contacts added</p>
            <p className="mt-1 text-sm text-muted-foreground">The selected contacts are now in the campaign. No outreach was sent.</p>
            <Button className="mt-5" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <Textarea
                value={text}
                onChange={(event) => changeText(event.target.value)}
                rows={5}
                maxLength={MAX_TEXT_LENGTH}
                disabled={importing}
                placeholder={"Paste unstructured contact details here…\n\nExample: Maya Chen, VP of Operations at Northstar Labs, maya@example.com"}
                aria-label="Contact text to parse"
                data-testid="paste-contacts-text"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-xs ${text.length > MAX_TEXT_LENGTH ? "text-destructive" : "text-muted-foreground"}`}>{text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()} characters</span>
                <Button variant="outline" size="sm" onClick={parse} disabled={!text.trim() || text.length > MAX_TEXT_LENGTH || pending || importing}>
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {pending ? "Reviewing contacts…" : "Extract contacts"}
                </Button>
              </div>
            </div>

            {error && <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}<Button variant="link" size="sm" className="ml-auto h-auto p-0 text-destructive" onClick={parse}>Retry</Button></div>}
            {pending && <div role="status" className="space-y-2 rounded-md border bg-muted/30 p-4"><div className="h-3 w-40 animate-pulse rounded bg-muted" /><div className="h-3 w-full animate-pulse rounded bg-muted" /><div className="h-3 w-2/3 animate-pulse rounded bg-muted" /></div>}
            {parsed && contacts.length === 0 && <div className="rounded-md border border-dashed px-4 py-7 text-center"><p className="text-sm font-medium">No named contacts found</p><p className="mt-1 text-xs text-muted-foreground">Try adding a person's name and more context, then extract again.</p></div>}
            {warnings.length > 0 && <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status"><p className="font-semibold">Review notes</p>{warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}</div>}
            {contacts.length > 0 && (
              <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{contacts.length} contact{contacts.length === 1 ? "" : "s"} extracted</span>
                  <Button variant="link" size="sm" className="h-auto p-0" disabled={importing} onClick={() => setSelected(allSelectableSelected ? new Set() : new Set(selectableIndices))}>
                    {allSelectableSelected ? "Clear selection" : "Select all"}
                  </Button>
                </div>
                {contacts.map((contact, index) => {
                  const issue = contactIssue(contact, requireEmailOrLinkedin);
                  const eligible = !issue;
                  return <div key={index} className={`grid gap-2 rounded-md border p-3 sm:grid-cols-[24px_repeat(2,minmax(0,1fr))] ${selected.has(index) ? "bg-background" : "bg-muted/30 opacity-70"}`}>
                    <div className="pt-2"><Checkbox aria-label={`Select ${contact.name || `contact ${index + 1}`}`} checked={selected.has(index)} disabled={!eligible || importing} onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); checked ? next.add(index) : next.delete(index); return next; })} /></div>
                    {(["name", "title", "companyName", "email", "linkedinUrl"] as const).map((field) => (
                      <label key={field} className="block min-w-0">
                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{field === "companyName" ? "Company" : field === "linkedinUrl" ? "LinkedIn URL" : field}</span>
                        <Input value={contact[field]} disabled={importing} maxLength={field === "linkedinUrl" ? 2000 : field === "name" ? 300 : field === "email" ? 320 : 500} onChange={(event) => updateContact(index, field, event.target.value)} className="h-8 text-xs" aria-label={`${field} for ${contact.name || `contact ${index + 1}`}`} />
                      </label>
                    ))}
                    {issue && <p className="text-xs text-amber-800 sm:col-start-2 sm:col-span-2">{issue}</p>}
                  </div>;
                })}
              </div>
            )}
            {importError && <p role="alert" className="text-sm text-destructive">{importError}</p>}
            <DialogFooter className="items-center justify-between gap-2 sm:justify-between">
              <span className="text-xs text-muted-foreground">{selected.size} of {selectableIndices.length} selectable selected</span>
              <Button onClick={importSelected} disabled={!selected.size || importing || pending}>
                {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {importing ? "Importing…" : `Import ${selected.size || ""} selected`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
