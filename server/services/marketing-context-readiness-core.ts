/**
 * Marketing Context Readiness — pure scoring core.
 *
 * No I/O and no imports, so it is safe to unit-test in isolation. The async
 * loader that gathers the raw signals from the database lives in
 * `marketing-context-readiness.ts`.
 */

export type ReadinessStatus = "ready" | "thin" | "missing";

export interface ReadinessItem {
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  /** What the user should do to improve this field. */
  fixHint: string;
  /** In-app route where the fix is performed. */
  fixPath: string;
}

export interface ReadinessReport {
  items: ReadinessItem[];
  readyCount: number;
  thinCount: number;
  missingCount: number;
  totalCount: number;
  /** 0–100, weighting ready = 1, thin = 0.5, missing = 0. */
  score: number;
  overall: "ready" | "partial" | "incomplete";
}

/** Raw signals about a tenant's intrinsic marketing data. */
export interface ReadinessInputs {
  hasCompanyProfile: boolean;
  companyHasDescription: boolean;
  personaCount: number;
  icpPersonaCount: number;
  messagingFrameworkGenerated: boolean;
  gtmPlanGenerated: boolean;
  productCount: number;
  competitorCount: number;
  brand: {
    primaryColorCustomised: boolean;
    hasLogo: boolean;
    fontCount: number;
  };
}

const STATUS_WEIGHT: Record<ReadinessStatus, number> = {
  ready: 1,
  thin: 0.5,
  missing: 0,
};

/**
 * Pure scoring core — turns raw signals into a structured readiness report.
 */
export function deriveReadiness(input: ReadinessInputs): ReadinessReport {
  const items: ReadinessItem[] = [];

  // Company profile
  items.push({
    key: "companyProfile",
    label: "Company Profile",
    status: !input.hasCompanyProfile
      ? "missing"
      : input.companyHasDescription
        ? "ready"
        : "thin",
    detail: !input.hasCompanyProfile
      ? "No company profile yet."
      : input.companyHasDescription
        ? "Company profile with description is set."
        : "Company profile exists but has no description.",
    fixHint: "Set your company name, website, and a clear description.",
    fixPath: "/app/company-baseline",
  });

  // ICP / personas
  items.push({
    key: "icp",
    label: "Ideal Customer Profile (Personas)",
    status: input.personaCount === 0
      ? "missing"
      : input.icpPersonaCount === 0
        ? "thin"
        : "ready",
    detail: input.personaCount === 0
      ? "No buyer personas defined."
      : input.icpPersonaCount === 0
        ? `${input.personaCount} persona(s), but none flagged as the ICP.`
        : `${input.icpPersonaCount} ICP persona(s) defined.`,
    fixHint: "Define at least one buyer persona and mark your primary one as the ICP.",
    fixPath: "/app/marketing/personas",
  });

  // Messaging framework (MPF)
  items.push({
    key: "messagingFramework",
    label: "Messaging Framework (MPF)",
    status: input.messagingFrameworkGenerated ? "ready" : "missing",
    detail: input.messagingFrameworkGenerated
      ? "Messaging framework generated."
      : "No messaging framework generated yet.",
    fixHint: "Generate the messaging framework — it becomes the voice of every AI content piece.",
    fixPath: "/app/marketing/messaging-framework",
  });

  // GTM plan
  items.push({
    key: "gtmPlan",
    label: "GTM Plan",
    status: input.gtmPlanGenerated ? "ready" : "thin",
    detail: input.gtmPlanGenerated
      ? "GTM plan generated."
      : "No GTM plan yet (recommended for strategy grounding).",
    fixHint: "Generate a GTM plan to ground content strategy and channel choices.",
    fixPath: "/app/marketing/messaging-framework",
  });

  // Products
  items.push({
    key: "products",
    label: "Products",
    status: input.productCount === 0 ? "missing" : "ready",
    detail: input.productCount === 0
      ? "No products defined."
      : `${input.productCount} product(s) defined.`,
    fixHint: "Add the products/offerings you market so content can reference them.",
    fixPath: "/app/products",
  });

  // Competitors (Cowork positioning wants 3–5)
  items.push({
    key: "competitors",
    label: "Competitors",
    status: input.competitorCount === 0
      ? "missing"
      : input.competitorCount < 3
        ? "thin"
        : "ready",
    detail: input.competitorCount === 0
      ? "No competitors tracked."
      : input.competitorCount < 3
        ? `${input.competitorCount} competitor(s) — 3–5 recommended for positioning.`
        : `${input.competitorCount} competitors tracked.`,
    fixHint: "Track 3–5 direct competitors to power positioning and differentiation.",
    fixPath: "/app/competitors",
  });

  // Brand kit (visual identity)
  const { primaryColorCustomised, hasLogo, fontCount } = input.brand;
  const brandSignals = [primaryColorCustomised, hasLogo, fontCount > 0].filter(Boolean).length;
  const brandStatus: ReadinessStatus =
    hasLogo && (primaryColorCustomised || fontCount > 0)
      ? "ready"
      : brandSignals > 0
        ? "thin"
        : "missing";
  items.push({
    key: "brandKit",
    label: "Brand Kit (colors, logo, fonts)",
    status: brandStatus,
    detail: brandSignals === 0
      ? "No brand colors, logo, or custom fonts set."
      : `Brand kit: ${hasLogo ? "logo set" : "no logo"}, ${primaryColorCustomised ? "custom colors" : "default colors"}, ${fontCount} custom font(s).`,
    fixHint: "Add a logo, set brand colors, and upload brand fonts so generated content and graphics stay on-brand.",
    fixPath: "/app/marketing/brand-library",
  });

  const readyCount = items.filter((i) => i.status === "ready").length;
  const thinCount = items.filter((i) => i.status === "thin").length;
  const missingCount = items.filter((i) => i.status === "missing").length;
  const totalCount = items.length;

  const weighted = items.reduce((sum, i) => sum + STATUS_WEIGHT[i.status], 0);
  const score = totalCount === 0 ? 0 : Math.round((weighted / totalCount) * 100);
  const overall: ReadinessReport["overall"] =
    score >= 85 ? "ready" : score >= 50 ? "partial" : "incomplete";

  return { items, readyCount, thinCount, missingCount, totalCount, score, overall };
}
