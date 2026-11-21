import { pool } from "../../db";
import type { RequestContext } from "../../context";
import type { OrbitSource } from "@shared/ask-orbit";
import { ASK_ORBIT_CONFIG } from "../../config/ask-orbit";
import { rankSources } from "./grounding";
import type { Pool } from "pg";

export type SourceAccess = Record<string, boolean>;
// Both sides of joins are scoped. Null-market legacy records belong ONLY to
// the default market. Null-tenant records never enter a prompt.
export function sourceScope(alias: string): string {
  if (!/^[a-z]+$/.test(alias)) throw new Error("Invalid static SQL alias");
  return `${alias}.tenant_domain=$1 AND (${alias}.market_id=$2 OR ($3 AND ${alias}.market_id IS NULL))`;
}

export async function retrieveSources(ctx: RequestContext, access: SourceAccess, question: string, queryPool: Pool = pool): Promise<OrbitSource[]> {
  const params = [ctx.tenantDomain, ctx.marketId, ctx.isDefaultMarket];
  const sources: OrbitSource[] = [];
  type Row = { id: string; title: string; body: string | null; date: Date | string | null; parent?: string };
  async function load(kind: string, sql: string, link: (r: Row) => string) {
    const { rows } = await queryPool.query<Row>(sql, params);
    for (const r of rows) {
      if (!r.body?.trim()) continue;
      const date = r.date && Number.isFinite(new Date(r.date).getTime()) ? new Date(r.date).toISOString() : null;
      sources.push({
        sourceId: `${kind}:${r.id}`, title: r.title.slice(0, 200), url: link(r), date,
        stale: !date || Date.now() - new Date(date).getTime() > ASK_ORBIT_CONFIG.staleDays * 86_400_000,
        text: r.body.slice(0, ASK_ORBIT_CONFIG.maxSourceCharacters),
      });
    }
  }
  // Baseline competitor profiles only: client-project intelligence is not
  // implicitly authorized by a company-wide conversation.
  await load("competitor", `SELECT c.id,c.name AS title,
    concat_ws(E'\\n',c.name,c.industry,c.headquarters,c.employee_count,c.revenue,
    left(c.analysis_data::text,3500)) AS body,c.last_full_crawl AS date
    FROM competitors c WHERE ${sourceScope("c")} AND c.project_id IS NULL
    ORDER BY c.last_full_crawl DESC NULLS LAST,c.id LIMIT 50`,
  r => `/app/competitors/${encodeURIComponent(r.id)}`);

  if (access.websiteMonitoring || access.socialMonitoring) {
    await load("change", `SELECT a.id,concat(c.name,': ',a.type) AS title,
      concat_ws(E'\\n',a.description,a.summary) AS body,a.created_at AS date,c.id AS parent
      FROM activity a JOIN competitors c ON c.id=a.competitor_id
      WHERE ${sourceScope("a")} AND ${sourceScope("c")} AND c.project_id IS NULL
      AND a.source_type='competitor'
      AND (CASE WHEN a.type ILIKE '%social%' THEN ${access.socialMonitoring ? "TRUE" : "FALSE"}
        ELSE ${access.websiteMonitoring ? "TRUE" : "FALSE"} END)
      ORDER BY a.created_at DESC,a.id LIMIT 80`, r => `/app/competitors/${encodeURIComponent(r.parent!)}#history`);
  }
  if (access.intelligenceBriefings) {
    await load("briefing", `SELECT b.id,'Intelligence briefing' AS title,
      left(b.briefing_data::text,4000) AS body,b.period_end AS date
      FROM intelligence_briefings b WHERE ${sourceScope("b")}
      ORDER BY b.created_at DESC,b.id LIMIT 12`, r => `/app/intelligence?id=${encodeURIComponent(r.id)}`);
  }
  for (const [type, feature, url] of [
    ["gtm_plan", "gtmPlan", "/app/marketing/gtm-plan"],
    ["messaging_framework", "messagingFramework", "/app/marketing/messaging-framework"],
  ]) {
    if (!access[feature]) continue;
    await load(type, `SELECT l.id,l.type AS title,left(l.content,4000) AS body,
      l.generated_from_data_as_of AS date FROM long_form_recommendations l
      WHERE ${sourceScope("l")} AND l.project_id IS NULL AND l.type='${type}'
      AND l.status='generated' ORDER BY l.updated_at DESC,l.id LIMIT 6`, () => url);
  }
  if (access.marketingPlanner) {
    await load("marketing", `SELECT p.id,p.name AS title,
      concat_ws(E'\\n',p.description,p.fiscal_year,p.status,
        (SELECT string_agg(t.line,E'\\n') FROM (
          SELECT concat_ws(' | ',t.title,t.description,t.timeframe,t.status) AS line
          FROM marketing_tasks t WHERE t.plan_id=p.id
          AND t.status NOT IN ('dismissed','removed','cancelled') ORDER BY t.updated_at DESC LIMIT 20
        ) t)) AS body,p.updated_at AS date
      FROM marketing_plans p WHERE ${sourceScope("p")} AND p.status<>'archived'
      ORDER BY p.updated_at DESC,p.id LIMIT 12`, r => `/app/marketing/projects/${encodeURIComponent(r.id)}`);
  }
  if (access.productManagement) {
    await load("roadmap", `SELECT r.id,concat(p.name,': ',r.title) AS title,
      concat_ws(E'\\n',r.title,r.description,r.quarter,r.year,r.status) AS body,
      r.updated_at AS date,p.id AS parent FROM roadmap_items r JOIN products p ON p.id=r.product_id
      WHERE ${sourceScope("r")} AND ${sourceScope("p")} AND p.is_baseline=TRUE
      ORDER BY r.updated_at DESC,r.id LIMIT 50`, r => `/app/products/${encodeURIComponent(r.parent!)}?tab=roadmap`);
  }
  return rankSources(sources, question, ASK_ORBIT_CONFIG.maxSources);
}
