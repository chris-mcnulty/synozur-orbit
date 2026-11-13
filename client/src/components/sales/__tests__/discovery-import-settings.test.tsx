// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DiscoveryImportSettings from "../discovery-import-settings";
import HubspotCompanySearch, { DiscoveryHubspotCheck } from "../hubspot-company-search";
import { newProspectClassificationPayload, type NewProspectClassificationValue } from "../new-prospect-classification";

afterEach(cleanup);

describe("reviewed discovery import settings", () => {
  it("labels only selected mixed-company rows and serializes existing relationship enums", () => {
    let latest: NewProspectClassificationValue = {};
    function Settings() {
      const [value, setValue] = useState<NewProspectClassificationValue>({});
      latest = value;
      return <DiscoveryImportSettings selectedCount={3} companyNames={["Cedar Systems", "Cedar Systems", "Morrow Labs"]} value={value} onChange={setValue} />;
    }
    render(<Settings />);
    expect(screen.getByText("Import settings · 3 selected")).toBeTruthy();
    expect(screen.getByText(/3 selected contacts across 2 companies/)).toBeTruthy();
    expect(screen.getByText(/Existing duplicates are skipped, not reclassified/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Current customer" }));
    fireEvent.click(screen.getByRole("button", { name: "Partner" }));
    fireEvent.click(screen.getByRole("button", { name: "Prospect" }));
    expect(newProspectClassificationPayload(latest)).toEqual({
      classification: { relationships: ["customer", "partner", "prospect"] },
    });
  });

  it("disables settings for an empty selection and leaves absent metadata omitted", () => {
    render(<DiscoveryImportSettings selectedCount={0} value={{}} onChange={vi.fn()} />);
    const fieldset = screen.getByTestId("discovery-import-settings") as HTMLFieldSetElement;
    expect(fieldset.disabled).toBe(true);
    expect(newProspectClassificationPayload({})).toEqual({});
  });
});

describe("HubSpot-first controls", () => {
  it("opens an explicitly requested company check without discovery or import calls", () => {
    const check = vi.fn();
    render(<DiscoveryHubspotCheck company="  cedar.example  " onCheck={check} />);
    expect(check).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check HubSpot first" }));
    expect(check).toHaveBeenCalledWith("cedar.example");
  });

  it("keeps company and person search separate and supports company-only submit", () => {
    const search = vi.fn();
    const company = vi.fn();
    const query = vi.fn();
    render(<HubspotCompanySearch company="Cedar" query="" onCompanyChange={company} onQueryChange={query} onSearch={search} />);
    fireEvent.change(screen.getByLabelText("Company name or domain"), { target: { value: "Morrow" } });
    fireEvent.change(screen.getByLabelText("Person search (optional)"), { target: { value: "Maya" } });
    expect(company).toHaveBeenCalledWith("Morrow");
    expect(query).toHaveBeenCalledWith("Maya");
    fireEvent.click(screen.getByRole("button", { name: "Search HubSpot" }));
    expect(search).toHaveBeenCalledTimes(1);
  });
});
