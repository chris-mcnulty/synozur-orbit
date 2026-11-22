import { getTenantClient, withHubspotRetry } from "./hubspot-integration";
import { importMapping, type ImportMapping, type OutcomeInput } from "@shared/win-loss";
import { WinLossError } from "./win-loss-core";

type Reader = (path: string, body?: unknown) => Promise<any>;
export async function hubspotReader(tenantDomain: string) {
  let tenant;
  try { tenant = await getTenantClient(tenantDomain); }
  catch { throw new WinLossError("HubSpot is disconnected or could not authenticate. Ask an admin to connect or reconnect HubSpot in Settings.", 409); }
  const { client, connection } = tenant;
  if (!connection.scopes?.includes("crm.objects.deals.read")) throw new WinLossError("HubSpot deal read scope missing. Ask an admin to reconnect in Settings.", 403);
  const read: Reader = async (path, body) => withHubspotRetry(async () => {
    const response = await client.apiRequest({ method: body ? "POST" : "GET", path, ...(body ? { body } : {}) });
    if (!response.ok) throw new WinLossError(response.status === 429 ? "HubSpot rate limited this preview. Retry later; nothing was imported." : `HubSpot returned ${response.status}. Check connection and deal/property permissions; nothing was imported.`, response.status === 429 ? 429 : 502);
    return response.json();
  });
  if (!connection.hubspotPortalId) throw new WinLossError("HubSpot portal identity missing. Reconnect before importing.", 409);
  return { read, portalId: connection.hubspotPortalId };
}
export async function discoverDeals(read: Reader) {
  const [properties, pipelines] = await Promise.all([read("/crm/v3/properties/deals"), read("/crm/v3/pipelines/deals")]);
  if (!Array.isArray(properties.results) || !Array.isArray(pipelines.results)) throw new WinLossError("Invalid HubSpot discovery response", 502);
  return { properties: properties.results.map((p: any) => ({ name: p.name, label: p.label, options: p.options ?? [] })),
    pipelines: pipelines.results.map((p: any) => ({ id: p.id, label: p.label, stages: p.stages.map((s: any) => ({ id: s.id, label: s.label, closed: s.metadata?.isClosed === "true" })) })) };
}
/** All pages must succeed before a review batch is saved. No partial imports. */
export async function previewDeals(read: Reader, mapping: ImportMapping) {
  importMapping.parse(mapping);
  const discovery = await discoverDeals(read);
  const validProperties = new Set(discovery.properties.map((p: any) => p.name));
  for (const prop of [mapping.label, mapping.closeDate, mapping.amount, mapping.currency, mapping.segment, mapping.competitor, mapping.reason].filter(Boolean)) {
      if (!validProperties.has(prop)) throw new WinLossError(`Unknown HubSpot property: ${prop}`);
  }
  const closedStages = new Set(discovery.pipelines.flatMap((p: any) => p.stages.filter((s: any) => s.closed).map((s: any) => `${p.id}:${s.id}`)));
  for (const key of Object.keys(mapping.stages)) if (!closedStages.has(key)) throw new WinLossError(`Stage ${key} is not a discovered closed stage`);
  if (!Object.keys(mapping.stages).length) throw new WinLossError("Map at least one closed pipeline stage to an outcome.");
  const properties = [...new Set(["pipeline", "dealstage", ...[mapping.label, mapping.closeDate, mapping.amount, mapping.currency, mapping.segment, mapping.competitor, mapping.reason].filter((v): v is string => !!v)])];
  const rows: any[] = []; const cursors = new Set<string>(); let after: string | undefined;
  do {
    let page;
    try { page = await read("/crm/v3/objects/deals/search", { filterGroups: [{ filters: [{ propertyName: "hs_is_closed", operator: "EQ", value: "true" }] }], properties, limit: 100, ...(after ? { after } : {}) }); }
    catch (e) {
      if (e instanceof WinLossError) throw e;
      throw new WinLossError("HubSpot could not return every deal page (possibly rate limited). The incomplete preview was discarded; retry later.", 502);
    }
    if (!Array.isArray(page.results)) throw new WinLossError("Invalid HubSpot deal page; preview discarded.", 502);
    if (Number(page.total) > 10000) throw new WinLossError("HubSpot search exceeds its 10,000-deal limit. Narrow the CRM dataset before retrying; no incomplete preview was retained.", 502);
    rows.push(...page.results);
    after = page.paging?.next?.after == null ? undefined : String(page.paging.next.after);
    if (after && (cursors.has(after) || rows.length >= 10000)) throw new WinLossError("HubSpot pagination incomplete or search limit reached. Narrow the CRM dataset before retrying; nothing was imported.", 502);
    if (after) cursors.add(after);
  } while (after);
  return rows.map(d => {
    const p = d.properties || {};
    const rawDate = p[mapping.closeDate];
    const date = rawDate ? new Date(/^\d+$/.test(rawDate) ? Number(rawDate) : rawDate) : null;
    const reason = mapping.reason ? p[mapping.reason] : null;
    const outcome = mapping.stages[`${p.pipeline}:${p.dealstage}`];
    const candidate: OutcomeInput = { dealLabel: p[mapping.label] || `Deal ${d.id}`, outcome: outcome || "no_decision",
      closeDate: date && !isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null,
      amount: p[mapping.amount] || null, currency: mapping.currency ? p[mapping.currency] || null : null,
      segment: mapping.segment ? p[mapping.segment] || null : null, competitorId: null, competitorConfirmed: false,
      reasonCodes: reason && mapping.reasons[reason] ? [mapping.reasons[reason]] : [], notes: "" };
    return { externalId: String(d.id), candidate, raw: p, competitorText: mapping.competitor ? p[mapping.competitor] || null : null,
      reasonText: reason || null, warnings: [...(!outcome ? ["Unmapped pipeline outcome: choose explicitly before importing"] : []), ...(reason && !mapping.reasons[reason] ? ["Unmapped CRM reason; review without inventing a reason"] : [])] };
  });
}
