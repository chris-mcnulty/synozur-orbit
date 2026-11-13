import { useId } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface HubspotCompanySearchProps {
  company: string;
  query: string;
  onCompanyChange: (company: string) => void;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  searching?: boolean;
}

/** Company and person query intentionally remain separate API fields. */
export default function HubspotCompanySearch({
  company, query, onCompanyChange, onQueryChange, onSearch, searching = false,
}: HubspotCompanySearchProps) {
  const id = useId();
  return (
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!searching) onSearch(); }}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-company`}>Company name or domain</Label>
          <Input id={`${id}-company`} value={company} maxLength={200}
            placeholder="Company name or domain"
            onChange={event => onCompanyChange(event.target.value)}
            data-testid="input-hubspot-company" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-person`}>Person search (optional)</Label>
          <Input id={`${id}-person`} value={query}
            placeholder="Name or email"
            onChange={event => onQueryChange(event.target.value)}
            data-testid="input-hubspot-search" />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Search by company alone, or narrow to a person.</p>
        <Button type="submit" size="sm" variant="outline" disabled={searching} data-testid="button-hubspot-search">
          <Search className="mr-1.5 h-3.5 w-3.5" />
          {searching ? "Searching HubSpot…" : "Search HubSpot"}
        </Button>
      </div>
    </form>
  );
}

export function DiscoveryHubspotCheck({
  company, onCheck, disabled = false,
}: { company: string; onCheck: (company: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <p className="text-xs text-muted-foreground">Review existing relationships before using Apollo. Nothing is imported automatically.</p>
      <Button type="button" size="sm" variant="outline" disabled={disabled}
        onClick={() => onCheck(company.trim())} data-testid="button-discovery-check-hubspot">
        <Search className="mr-1.5 h-3.5 w-3.5" />Check HubSpot first
      </Button>
    </div>
  );
}
