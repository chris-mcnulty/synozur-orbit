import { useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/queryClient";

export interface HubspotPreviewContact {
  hubspotContactId: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  company: string | null;
  alreadyOnCampaign: boolean;
}

/** All requests are explicit. Late responses cannot restore an old scope or selection. */
export function useHubspotPreview(campaignId: string, scope: string) {
  const [company, setCompanyValue] = useState("");
  const [query, setQueryValue] = useState("");
  const [contacts, setContacts] = useState<HubspotPreviewContact[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const generation = useRef(0);
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const mounted = useRef(true);

  function clear() {
    generation.current += 1;
    setContacts(null);
    setSelected(new Set());
    setSearching(false);
    setError(null);
    setNotConnected(false);
  }
  function setCompany(next: string) { clear(); setCompanyValue(next); }
  function setQuery(next: string) { clear(); setQueryValue(next); }
  function reset(nextCompany = "") {
    clear();
    setCompanyValue(nextCompany);
    setQueryValue("");
  }

  useEffect(() => {
    reset();
    return () => { generation.current += 1; };
  }, [scope, campaignId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  async function request(body: { company?: string; query?: string; listId?: string; limit: number }) {
    clear();
    const token = generation.current;
    const requestScope = scope;
    const active = () => mounted.current && token === generation.current && requestScope === liveScope.current;
    setSearching(true);
    try {
      const response = await apiRequest("POST", `/api/sales-outreach/campaigns/${campaignId}/preview-hubspot`, body);
      const data = await response.json();
      if (!active()) return;
      if (!response.ok) {
        if (data.code === "no_hubspot") { setNotConnected(true); return; }
        throw new Error(data.error || "Search failed");
      }
      const rows: HubspotPreviewContact[] = data.contacts ?? [];
      setContacts(rows);
      setSelected(new Set(rows.filter(row => !row.alreadyOnCampaign).map(row => row.hubspotContactId)));
    } catch (cause) {
      if (active()) {
        if (cause instanceof ApiError && cause.code === "no_hubspot") setNotConnected(true);
        else setError(cause instanceof Error ? cause.message : "HubSpot search failed");
      }
    } finally {
      if (active()) setSearching(false);
    }
  }

  function search(companyOverride = company, queryOverride = query) {
    return request({
      company: companyOverride.trim() || undefined,
      query: queryOverride.trim() || undefined,
      limit: 50,
    });
  }

  return {
    company, query, contacts, selected, searching, error, notConnected,
    setCompany, setQuery, setSelected, clear, reset, search,
    searchList: (listId: string) => request({ listId, limit: 100 }),
  };
}
