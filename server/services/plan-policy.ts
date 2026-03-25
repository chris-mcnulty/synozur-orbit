import { storage } from "../storage";

export interface FeatureDefinition {
  key: string;
  label: string;
  description: string;
  category: "intelligence" | "monitoring" | "planning" | "marketing" | "platform";
}

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  { key: "battlecards", label: "Sales Battlecards", description: "Generate competitive battlecards for sales teams", category: "intelligence" },
  { key: "recommendations", label: "AI Recommendations", description: "AI-powered strategic recommendations", category: "intelligence" },
  { key: "pdfReports", label: "PDF Reports", description: "Generate branded PDF competitive reports", category: "intelligence" },
  { key: "gtmPlan", label: "GTM Plan", description: "AI-generated Go-To-Market plans", category: "intelligence" },
  { key: "messagingFramework", label: "Messaging Framework", description: "AI-generated messaging frameworks", category: "intelligence" },
  { key: "socialMonitoring", label: "Social Media Monitoring", description: "Track competitor social media presence", category: "monitoring" },
  { key: "websiteMonitoring", label: "Website Change Detection", description: "AI-powered website change monitoring", category: "monitoring" },
  { key: "clientProjects", label: "Client Projects", description: "Product-level competitive analysis projects", category: "intelligence" },
  { key: "marketingPlanner", label: "Marketing Planner", description: "AI-powered quarterly/annual marketing planning", category: "planning" },
  { key: "productManagement", label: "Product Management", description: "Roadmap prioritization and feature tracking", category: "planning" },
  { key: "multiMarket", label: "Multi-Market Support", description: "Manage multiple client contexts in one tenant", category: "platform" },
  { key: "ssoIntegration", label: "SSO Integration", description: "Microsoft Entra ID / Google SSO login", category: "platform" },
  { key: "customBranding", label: "Custom Branding", description: "Custom logos, colors, and branded reports", category: "platform" },
  { key: "socialPosts", label: "Social Post Generator", description: "AI-generated social media posts from competitive intelligence", category: "marketing" },
  { key: "emailNewsletters", label: "Email Newsletter Generator", description: "AI-powered email newsletters from market intelligence", category: "marketing" },
  { key: "contentLibrary", label: "Content Library", description: "Manage marketing content assets, categories, and product tags", category: "marketing" },
  { key: "brandLibrary", label: "Brand Library", description: "Manage brand-approved visual assets and templates", category: "marketing" },
  { key: "campaigns", label: "Campaigns", description: "Campaign management with asset and social account coordination", category: "marketing" },
  { key: "socialAccounts", label: "Social Accounts", description: "Connect and manage social media accounts for publishing", category: "marketing" },
  { key: "saturnCapture", label: "Saturn Capture Extension", description: "Browser extension for capturing web content into the content library", category: "marketing" },
  { key: "intelligenceBriefings", label: "Intelligence Briefings", description: "AI-synthesized periodic market intelligence reports with executive summaries", category: "intelligence" },
  { key: "podcastBriefings", label: "Podcast Briefings", description: "AI-generated podcast-style audio summaries of intelligence briefings", category: "intelligence" },
  { key: "scheduledBriefingUpdates", label: "Scheduled Briefing Updates", description: "Automatic weekly briefing generation with email delivery", category: "intelligence" },
];

export const FEATURE_CATEGORIES = [
  { key: "intelligence", label: "Competitive Intelligence" },
  { key: "monitoring", label: "Monitoring" },
  { key: "planning", label: "Planning & Management" },
  { key: "marketing", label: "Marketing" },
  { key: "platform", label: "Platform" },
] as const;

export type FeatureKey = string;

export interface PlanFeatures {
  competitorLimit: number;
  analysisLimit: number;
  adminUserLimit: number;
  readWriteUserLimit: number;
  readOnlyUserLimit: number;
  [key: string]: boolean | number;
}

const DEFAULT_PLAN_FEATURES: Record<string, Record<string, boolean>> = {
  free: {
    battlecards: false,
    recommendations: false,
    pdfReports: false,
    socialMonitoring: false,
    clientProjects: false,
    gtmPlan: false,
    messagingFramework: false,
    marketingPlanner: false,
    productManagement: false,
    multiMarket: false,
    websiteMonitoring: false,
    ssoIntegration: false,
    customBranding: false,
    socialPosts: false,
    emailNewsletters: false,
    contentLibrary: false,
    brandLibrary: false,
    campaigns: false,
    socialAccounts: false,
    saturnCapture: false,
    intelligenceBriefings: false,
    podcastBriefings: false,
    scheduledBriefingUpdates: false,
  },
  trial: {
    battlecards: true,
    recommendations: true,
    pdfReports: true,
    socialMonitoring: false,
    clientProjects: false,
    gtmPlan: true,
    messagingFramework: true,
    marketingPlanner: false,
    productManagement: false,
    multiMarket: false,
    websiteMonitoring: false,
    ssoIntegration: false,
    customBranding: false,
    socialPosts: false,
    emailNewsletters: false,
    contentLibrary: false,
    brandLibrary: false,
    campaigns: false,
    socialAccounts: false,
    saturnCapture: false,
    intelligenceBriefings: false,
    podcastBriefings: false,
    scheduledBriefingUpdates: false,
  },
  pro: {
    battlecards: true,
    recommendations: true,
    pdfReports: true,
    socialMonitoring: true,
    clientProjects: true,
    gtmPlan: true,
    messagingFramework: true,
    marketingPlanner: false,
    productManagement: false,
    multiMarket: false,
    websiteMonitoring: true,
    ssoIntegration: true,
    customBranding: false,
    socialPosts: false,
    emailNewsletters: false,
    contentLibrary: false,
    brandLibrary: false,
    campaigns: false,
    socialAccounts: false,
    saturnCapture: false,
    intelligenceBriefings: true,
    podcastBriefings: true,
    scheduledBriefingUpdates: false,
  },
  enterprise: {
    battlecards: true,
    recommendations: true,
    pdfReports: true,
    socialMonitoring: true,
    clientProjects: true,
    gtmPlan: true,
    messagingFramework: true,
    marketingPlanner: true,
    productManagement: true,
    multiMarket: true,
    websiteMonitoring: true,
    ssoIntegration: true,
    customBranding: true,
    socialPosts: true,
    emailNewsletters: true,
    contentLibrary: true,
    brandLibrary: true,
    campaigns: true,
    socialAccounts: true,
    saturnCapture: true,
    intelligenceBriefings: true,
    podcastBriefings: true,
    scheduledBriefingUpdates: true,
  },
  unlimited: {
    battlecards: true,
    recommendations: true,
    pdfReports: true,
    socialMonitoring: true,
    clientProjects: true,
    gtmPlan: true,
    messagingFramework: true,
    marketingPlanner: true,
    productManagement: true,
    multiMarket: true,
    websiteMonitoring: true,
    ssoIntegration: true,
    customBranding: true,
    socialPosts: true,
    emailNewsletters: true,
    contentLibrary: true,
    brandLibrary: true,
    campaigns: true,
    socialAccounts: true,
    saturnCapture: true,
    intelligenceBriefings: true,
    podcastBriefings: true,
    scheduledBriefingUpdates: true,
  },
};

const DEFAULT_PLAN_LIMITS: Record<string, { competitorLimit: number; analysisLimit: number; adminUserLimit: number; readWriteUserLimit: number; readOnlyUserLimit: number }> = {
  free: { competitorLimit: 1, analysisLimit: 1, adminUserLimit: 1, readWriteUserLimit: 0, readOnlyUserLimit: 0 },
  trial: { competitorLimit: 3, analysisLimit: 5, adminUserLimit: 1, readWriteUserLimit: 2, readOnlyUserLimit: 5 },
  pro: { competitorLimit: 10, analysisLimit: -1, adminUserLimit: 3, readWriteUserLimit: 10, readOnlyUserLimit: 20 },
  enterprise: { competitorLimit: -1, analysisLimit: -1, adminUserLimit: -1, readWriteUserLimit: -1, readOnlyUserLimit: -1 },
  unlimited: { competitorLimit: -1, analysisLimit: -1, adminUserLimit: -1, readWriteUserLimit: -1, readOnlyUserLimit: -1 },
};

let planCache: Map<string, { features: Record<string, boolean>; limits: typeof DEFAULT_PLAN_LIMITS.free }> | null = null;
let planCacheTime = 0;
const CACHE_TTL = 60_000;

async function loadPlansFromDb(): Promise<Map<string, { features: Record<string, boolean>; limits: typeof DEFAULT_PLAN_LIMITS.free }>> {
  if (planCache && Date.now() - planCacheTime < CACHE_TTL) {
    return planCache;
  }
  try {
    const dbPlans = await storage.getAllServicePlans();
    const map = new Map<string, { features: Record<string, boolean>; limits: typeof DEFAULT_PLAN_LIMITS.free }>();
    for (const plan of dbPlans) {
      if (!plan.isActive) continue;
      const dbFeatures = (plan.features && typeof plan.features === "object" && !Array.isArray(plan.features))
        ? plan.features as Record<string, boolean>
        : {};
      const fallbackFeatures = DEFAULT_PLAN_FEATURES[plan.name] || DEFAULT_PLAN_FEATURES.free;
      const mergedFeatures: Record<string, boolean> = { ...fallbackFeatures, ...dbFeatures };
      map.set(plan.name, {
        features: mergedFeatures,
        limits: {
          competitorLimit: plan.competitorLimit,
          analysisLimit: plan.analysisLimit,
          adminUserLimit: plan.adminUserLimit,
          readWriteUserLimit: plan.readWriteUserLimit,
          readOnlyUserLimit: plan.readOnlyUserLimit,
        },
      });
    }
    planCache = map;
    planCacheTime = Date.now();
    return map;
  } catch {
    return new Map();
  }
}

export function invalidatePlanCache() {
  planCache = null;
  planCacheTime = 0;
}

function buildUnlimitedFeatures(): PlanFeatures {
  const allTrue: Record<string, boolean> = {};
  for (const feat of FEATURE_REGISTRY) {
    allTrue[feat.key] = true;
  }
  return {
    ...DEFAULT_PLAN_LIMITS.unlimited,
    ...allTrue,
  };
}

export async function getPlanFeaturesAsync(planName: string): Promise<PlanFeatures> {
  if (planName === "unlimited") return buildUnlimitedFeatures();
  const plans = await loadPlansFromDb();
  const dbPlan = plans.get(planName);
  if (dbPlan) {
    return {
      ...dbPlan.limits,
      ...dbPlan.features,
    };
  }
  const fallbackLimits = DEFAULT_PLAN_LIMITS[planName] || DEFAULT_PLAN_LIMITS.free;
  const fallbackFeatures = DEFAULT_PLAN_FEATURES[planName] || DEFAULT_PLAN_FEATURES.free;
  return { ...fallbackLimits, ...fallbackFeatures };
}

export function getPlanFeatures(planName: string): PlanFeatures {
  if (planName === "unlimited") return buildUnlimitedFeatures();
  const fallbackLimits = DEFAULT_PLAN_LIMITS[planName] || DEFAULT_PLAN_LIMITS.free;
  const fallbackFeatures = DEFAULT_PLAN_FEATURES[planName] || DEFAULT_PLAN_FEATURES.free;
  return { ...fallbackLimits, ...fallbackFeatures };
}

export function isFeatureEnabled(plan: string, feature: FeatureKey): boolean {
  if (plan === "unlimited") return true;
  const features = getPlanFeatures(plan);
  return features[feature] === true;
}

export async function isFeatureEnabledAsync(plan: string, feature: FeatureKey): Promise<boolean> {
  if (plan === "unlimited") return true;
  const features = await getPlanFeaturesAsync(plan);
  return features[feature] === true;
}

export function getRequiredPlan(feature: FeatureKey): string {
  const trialFeatures = DEFAULT_PLAN_FEATURES.trial;
  if (trialFeatures[feature]) return "Trial";
  const proFeatures = DEFAULT_PLAN_FEATURES.pro;
  if (proFeatures[feature]) return "Pro";
  return "Enterprise";
}

export interface PlanUsage {
  competitorCount: number;
  monthlyAnalysisCount: number;
}

export interface PlanGateResult {
  allowed: boolean;
  reason?: string;
  upgradeRequired?: boolean;
  requiredPlan?: string;
  currentUsage?: number;
  limit?: number;
}

export async function checkCompetitorLimitAsync(plan: string, currentCount: number): Promise<PlanGateResult> {
  if (plan === "unlimited") return { allowed: true };
  const features = await getPlanFeaturesAsync(plan);
  const limit = features.competitorLimit as number;
  if (limit === -1) {
    return { allowed: true };
  }
  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows up to ${limit} competitor${limit === 1 ? "" : "s"} across all markets (currently using ${currentCount}). Upgrade your plan to add more.`,
      upgradeRequired: true,
      requiredPlan: plan === "free" ? "Trial" : "Pro",
      currentUsage: currentCount,
      limit,
    };
  }
  return { allowed: true };
}

export function checkCompetitorLimit(plan: string, currentCount: number): PlanGateResult {
  if (plan === "unlimited") return { allowed: true };
  const features = getPlanFeatures(plan);
  const limit = features.competitorLimit as number;
  if (limit === -1) {
    return { allowed: true };
  }
  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows up to ${limit} competitor${limit === 1 ? "" : "s"} across all markets (currently using ${currentCount}). Upgrade your plan to add more.`,
      upgradeRequired: true,
      requiredPlan: plan === "free" ? "Trial" : "Pro",
      currentUsage: currentCount,
      limit,
    };
  }
  return { allowed: true };
}

export async function checkAnalysisLimitAsync(plan: string, monthlyCount: number): Promise<PlanGateResult> {
  if (plan === "unlimited") return { allowed: true };
  const features = await getPlanFeaturesAsync(plan);
  const limit = features.analysisLimit as number;
  if (limit === -1) {
    return { allowed: true };
  }
  if (monthlyCount >= limit) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows ${limit} analysis generation${limit === 1 ? "" : "s"} per month. Upgrade your plan for more.`,
      upgradeRequired: true,
      requiredPlan: plan === "free" ? "Trial" : "Pro",
      currentUsage: monthlyCount,
      limit,
    };
  }
  return { allowed: true };
}

export function checkAnalysisLimit(plan: string, monthlyCount: number): PlanGateResult {
  if (plan === "unlimited") return { allowed: true };
  const features = getPlanFeatures(plan);
  const limit = features.analysisLimit as number;
  if (limit === -1) {
    return { allowed: true };
  }
  if (monthlyCount >= limit) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows ${limit} analysis generation${limit === 1 ? "" : "s"} per month. Upgrade your plan for more.`,
      upgradeRequired: true,
      requiredPlan: plan === "free" ? "Trial" : "Pro",
      currentUsage: monthlyCount,
      limit,
    };
  }
  return { allowed: true };
}

export async function checkFeatureAccessAsync(plan: string, feature: FeatureKey): Promise<PlanGateResult> {
  if (plan === "unlimited") return { allowed: true };
  const enabled = await isFeatureEnabledAsync(plan, feature);
  if (enabled) {
    return { allowed: true };
  }
  const requiredPlan = getRequiredPlan(feature);
  const def = FEATURE_REGISTRY.find(f => f.key === feature);
  const label = def?.label || feature;
  return {
    allowed: false,
    reason: `${label} requires a ${requiredPlan} plan or higher.`,
    upgradeRequired: true,
    requiredPlan,
  };
}

export function checkFeatureAccess(plan: string, feature: FeatureKey): PlanGateResult {
  if (plan === "unlimited") return { allowed: true };
  if (isFeatureEnabled(plan, feature)) {
    return { allowed: true };
  }
  const requiredPlan = getRequiredPlan(feature);
  const def = FEATURE_REGISTRY.find(f => f.key === feature);
  const label = def?.label || feature;
  return {
    allowed: false,
    reason: `${label} requires a ${requiredPlan} plan or higher.`,
    upgradeRequired: true,
    requiredPlan,
  };
}

export async function getMonthlyAnalysisCount(tenantDomain: string): Promise<number> {
  const { db } = await import("../db");
  const { aiUsage } = await import("../../shared/schema");
  const { and, eq, gte } = await import("drizzle-orm");
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const results = await db.select().from(aiUsage)
    .where(and(
      eq(aiUsage.tenantDomain, tenantDomain),
      gte(aiUsage.createdAt, startOfMonth),
      eq(aiUsage.success, true)
    ));
  const analysisOps = new Set(["analyze_competitor", "generate_analysis", "full_analysis", "quick_analysis", "run_analysis"]);
  return results.filter((r: any) => analysisOps.has(r.operation)).length;
}

export async function getTenantCompetitorCount(tenantDomain: string): Promise<number> {
  const competitors = await storage.getCompetitorsByTenantDomain(tenantDomain);
  return (competitors || []).filter((c: any) => !c.projectId).length;
}

export async function seedDefaultPlans(): Promise<void> {
  const planDefs = [
    {
      name: "trial",
      displayName: "Trial",
      description: "60 days full access",
      ...DEFAULT_PLAN_LIMITS.trial,
      features: DEFAULT_PLAN_FEATURES.trial,
      multiMarketEnabled: false,
      marketLimit: null,
      socialMonitoringEnabled: false,
      websiteMonitorEnabled: false,
      productMonitorEnabled: false,
      trialDays: 60,
      isActive: true,
      isDefault: true,
      sortOrder: 0,
    },
    {
      name: "free",
      displayName: "Free",
      description: "Basic competitive monitoring",
      ...DEFAULT_PLAN_LIMITS.free,
      features: DEFAULT_PLAN_FEATURES.free,
      multiMarketEnabled: false,
      marketLimit: null,
      socialMonitoringEnabled: false,
      websiteMonitorEnabled: false,
      productMonitorEnabled: false,
      isActive: true,
      isDefault: false,
      sortOrder: 1,
    },
    {
      name: "pro",
      displayName: "Pro",
      description: "Full intelligence suite",
      ...DEFAULT_PLAN_LIMITS.pro,
      features: DEFAULT_PLAN_FEATURES.pro,
      multiMarketEnabled: false,
      marketLimit: null,
      socialMonitoringEnabled: true,
      websiteMonitorEnabled: true,
      productMonitorEnabled: true,
      isActive: true,
      isDefault: false,
      sortOrder: 2,
    },
    {
      name: "enterprise",
      displayName: "Enterprise",
      description: "Complete GTM platform",
      ...DEFAULT_PLAN_LIMITS.enterprise,
      features: DEFAULT_PLAN_FEATURES.enterprise,
      multiMarketEnabled: true,
      marketLimit: null,
      socialMonitoringEnabled: true,
      websiteMonitorEnabled: true,
      productMonitorEnabled: true,
      isActive: true,
      isDefault: false,
      sortOrder: 3,
    },
    {
      name: "unlimited",
      displayName: "Unlimited (Internal)",
      description: "Synozur internal - unlimited access to all features",
      ...DEFAULT_PLAN_LIMITS.unlimited,
      features: DEFAULT_PLAN_FEATURES.unlimited,
      multiMarketEnabled: true,
      marketLimit: null,
      socialMonitoringEnabled: true,
      websiteMonitorEnabled: true,
      productMonitorEnabled: true,
      isActive: true,
      isDefault: false,
      sortOrder: 99,
    },
  ];

  for (const def of planDefs) {
    try {
      const existing = await storage.getServicePlanByName(def.name);
      if (!existing) {
        await storage.createServicePlan(def as any);
        console.log(`[Plan Seed] Created plan: ${def.displayName}`);
      } else {
        const existingFeatures = (existing.features && typeof existing.features === "object" && !Array.isArray(existing.features))
          ? existing.features as Record<string, boolean>
          : {};
        const defaultFeatures = def.features as Record<string, boolean>;

        if (def.name === "unlimited") {
          const correctedFeatures: Record<string, boolean> = { ...existingFeatures };
          let correctedCount = 0;
          for (const k of Object.keys(defaultFeatures)) {
            if (correctedFeatures[k] !== true) {
              correctedFeatures[k] = true;
              correctedCount++;
            }
          }
          for (const k of Object.keys(correctedFeatures)) {
            if (correctedFeatures[k] !== true) {
              correctedFeatures[k] = true;
              correctedCount++;
            }
          }
          if (correctedCount > 0) {
            await storage.updateServicePlan(existing.id, { features: correctedFeatures } as any);
            console.log(`[Plan Seed] Force-corrected ${correctedCount} feature(s) to true for Unlimited plan`);
          }
        } else {
          const missingKeys = Object.keys(defaultFeatures).filter(k => !(k in existingFeatures));
          if (missingKeys.length > 0) {
            const merged = { ...existingFeatures };
            for (const k of missingKeys) {
              merged[k] = defaultFeatures[k];
            }
            await storage.updateServicePlan(existing.id, { features: merged } as any);
            console.log(`[Plan Seed] Synced ${missingKeys.length} new feature(s) for plan ${def.displayName}: ${missingKeys.join(", ")}`);
          }
        }
      }
    } catch (err: any) {
      console.error(`[Plan Seed] Error seeding plan ${def.name}:`, err.message);
    }
  }
}
