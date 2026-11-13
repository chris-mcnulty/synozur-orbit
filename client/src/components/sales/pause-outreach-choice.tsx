export function PauseOutreachChoice({ checked, onChange }: {
  checked: boolean; onChange: (checked: boolean) => void;
}) {
  return <div className="space-y-1.5 rounded-md border p-3">
    <label className="flex items-start gap-2 text-sm font-medium">
      <input type="checkbox" className="mt-1" checked={checked} onChange={event => onChange(event.target.checked)} />
      Pause outreach for this shared contact
    </label>
    <p className="text-xs text-muted-foreground">After logging a message sent in Outlook, Cowork, or elsewhere, place this contact on hold across all campaigns in this workspace, not just this campaign. Scheduled next actions are cleared. Nothing is sent. Leaving this unchecked keeps any existing hold; it never enables or resumes sending.</p>
  </div>;
}
