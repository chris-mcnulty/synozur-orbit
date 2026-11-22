import { z } from "zod";

export const OUTCOMES = ["won", "lost", "no_decision"] as const;
export const REASON_CODES = ["price", "capabilities", "service", "relationship", "timing", "budget", "status_quo", "other"] as const;
export const outcomeInput = z.object({
  dealLabel: z.string().trim().min(1).max(240),
  outcome: z.enum(OUTCOMES),
  closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
    const d = new Date(v); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid close date").nullable(),
  amount: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  segment: z.string().trim().max(160).nullable(),
  competitorId: z.string().max(100).nullable(),
  competitorConfirmed: z.boolean(),
  reasonCodes: z.array(z.enum(REASON_CODES)).max(8),
  notes: z.string().max(10000),
}).strict().superRefine((v, ctx) => {
  if (v.competitorId && !v.competitorConfirmed) ctx.addIssue({ code: "custom", message: "Confirm competitor attribution explicitly", path: ["competitorConfirmed"] });
});
export type OutcomeInput = z.infer<typeof outcomeInput>;
export type OutcomeRecord = OutcomeInput & {
  id: string; version: number; source: "manual" | "hubspot"; externalId: string | null;
  sourceSnapshot: unknown; updatedAt: string; createdAt: string;
};
export const importMapping = z.object({
  label: z.string().min(1), closeDate: z.string().min(1), amount: z.string().min(1),
  currency: z.string().nullable(), segment: z.string().nullable(), competitor: z.string().nullable(),
  reason: z.string().nullable(),
  stages: z.record(z.enum(OUTCOMES)),
  reasons: z.record(z.enum(REASON_CODES)),
}).strict();
export type ImportMapping = z.infer<typeof importMapping>;

export function summarizeOutcomes(rows: OutcomeInput[]) {
  const counts = (set: OutcomeInput[]) => {
    const won = set.filter(r => r.outcome === "won").length;
    const lost = set.filter(r => r.outcome === "lost").length;
    return { total: set.length, won, lost, noDecision: set.length - won - lost, denominator: won + lost, winRate: won + lost ? won / (won + lost) : null };
  };
  const group = (key: (r: OutcomeInput) => string) => Object.entries(
    rows.reduce<Record<string, OutcomeInput[]>>((a, r) => { (a[key(r)] ??= []).push(r); return a; }, {}))
    .map(([name, values]) => ({ name, ...counts(values) }));
  // Decimal fixed-point avoids floating-point drift and preserves large deal totals.
  const currencyUnits: Record<string, { count: number; won: bigint; lost: bigint; noDecision: bigint; total: bigint }> = {};
  for (const r of rows) if (r.amount !== null && r.currency) {
    const v = currencyUnits[r.currency] ??= { count: 0, won: 0n, lost: 0n, noDecision: 0n, total: 0n };
    const [whole, fraction = ""] = r.amount.split(".");
    const amount = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
    v.count++; v.total += amount;
    v[r.outcome === "no_decision" ? "noDecision" : r.outcome] += amount;
  }
  const decimal = (n: bigint) => `${n / 10000n}.${String(n % 10000n).padStart(4, "0")}`.replace(/\.?0+$/, "");
  const currencies = Object.fromEntries(Object.entries(currencyUnits).map(([currency, v]) => [currency,
    { count: v.count, won: decimal(v.won), lost: decimal(v.lost), noDecision: decimal(v.noDecision), total: decimal(v.total) }]));
  return { ...counts(rows), competitors: group(r => r.competitorId && r.competitorConfirmed ? r.competitorId : "Unattributed"), segments: group(r => r.segment || "Unknown"),
    currencies, coverage: { missingDate: rows.filter(r => !r.closeDate).length, missingAmount: rows.filter(r => r.amount === null).length,
      missingCurrency: rows.filter(r => !r.currency).length, missingSegment: rows.filter(r => !r.segment).length,
      missingCompetitor: rows.filter(r => !r.competitorId).length, missingReasons: rows.filter(r => !r.reasonCodes.length).length } };
}
