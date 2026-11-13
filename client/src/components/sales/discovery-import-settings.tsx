import NewProspectClassification, { type NewProspectClassificationValue } from "./new-prospect-classification";

export interface DiscoveryImportSettingsProps {
  selectedCount: number;
  companyNames?: readonly (string | null | undefined)[];
  value: NewProspectClassificationValue;
  onChange: (value: NewProspectClassificationValue) => void;
  disabled?: boolean;
}

/** The parent owns this value and resets it when opening a new discovery session. */
export default function DiscoveryImportSettings({
  selectedCount, companyNames = [], value, onChange, disabled = false,
}: DiscoveryImportSettingsProps) {
  const companies = new Set(companyNames.map(name => name?.trim()).filter(Boolean));
  return (
    <fieldset disabled={disabled || selectedCount === 0} className="min-w-0 space-y-2 rounded-md border p-3" data-testid="discovery-import-settings">
      <legend className="px-1 text-sm font-medium">
        Import settings · {selectedCount} selected
      </legend>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {selectedCount === 0
          ? "Select contacts to set their relationships and campaign settings."
          : `Shared settings apply only to the ${selectedCount} selected contact${selectedCount === 1 ? "" : "s"}${companies.size > 1 ? ` across ${companies.size} companies` : ""}.`}
        {" "}Existing duplicates are skipped, not reclassified. Unselected rows are unchanged.
      </p>
      <NewProspectClassification
        value={value}
        onChange={onChange}
        relationshipLabels={{ customer: "Current customer" }}
      />
    </fieldset>
  );
}
