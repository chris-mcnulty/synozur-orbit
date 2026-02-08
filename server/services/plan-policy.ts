import { storage } from "../storage";

export interface PlanFeatures {
  competitorLimit: number;
  analysisLimit: number; // per month, -1 = unlimited
  adminUserLimit: number;
  readWriteUserLimit: number;
  readOnlyUserLimit: number;
  battlecards: boolean;
  recommendations: boolean;
  pdfReports: boolean;
  socialMonitoring: boolean;
  clientProjects: boolean;
  gtmPlan: boolean;
  messagingFramework: boolean;
  marketingPlanner: boolean;
  productManagement: boolean;
  multiMarket: boolean;
  websiteMonitoring: boolean;
  ssoIntegration: boolean;
  customBranding: boolean;
}

const PLAN_FEATURES: Record<string, PlanFeatures> = {
  free: {
    competitorLimit: 1,
    analysisLimit: 1,
    adminUserLimit: 1,
    readWriteUserLimit: 0,
    readOnlyUserLimit: 0,
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
  },
  trial: {
    competitorLimit: 3,
    analysisLimit: 5,
    adminUserLimit: 1,
    readWriteUserLimit: 2,
    readOnlyUserLimit: 5,
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
  },
  pro: {
    competitorLimit: 10,
    analysisLimit: -1,
    adminUserLimit: 3,
    readWriteUserLimit: 10,
    readOnlyUserLimit: 20,
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
  },
  enterprise: {
    competitorLimit: -1,
    analysisLimit: -1,
    adminUserLimit: -1,
    readWriteUserLimit: -1,
    readOnlyUserLimit: -1,
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
  },
};

export function getPlanFeatures(plan: string): PlanFeatures {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.free;
}

export type FeatureKey = keyof Omit<PlanFeatures, "competitorLimit" | "analysisLimit" | "adminUserLimit" | "readWriteUserLimit" | "readOnlyUserLimit">;

export function isFeatureEnabled(plan: string, feature: FeatureKey): boolean {
  const features = getPlanFeatures(plan);
  return features[feature] as boolean;
}

export function getRequiredPlan(feature: FeatureKey): string {
  if (PLAN_FEATURES.trial[feature]) return "Trial";
  if (PLAN_FEATURES.pro[feature]) return "Pro";
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

export function checkCompetitorLimit(plan: string, currentCount: number): PlanGateResult {
  const features = getPlanFeatures(plan);
  if (features.competitorLimit === -1) {
    return { allowed: true };
  }
  if (currentCount >= features.competitorLimit) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows up to ${features.competitorLimit} competitor${features.competitorLimit === 1 ? "" : "s"}. Upgrade your plan to add more.`,
      upgradeRequired: true,
      requiredPlan: plan === "free" ? "Trial" : "Pro",
      currentUsage: currentCount,
      limit: features.competitorLimit,
    };
  }
  return { allowed: true };
}

export function checkAnalysisLimit(plan: string, monthlyCount: number): PlanGateResult {
  const features = getPlanFeatures(plan);
  if (features.analysisLimit === -1) {
    return { allowed: true };
  }
  if (monthlyCount >= features.analysisLimit) {
    return {
      allowed: false,
      reason: `Your ${plan} plan allows ${features.analysisLimit} analysis generation${features.analysisLimit === 1 ? "" : "s"} per month. Upgrade your plan for more.`,
      upgradeRequired: true,
      requiredPlan: plan === "free" ? "Trial" : "Pro",
      currentUsage: monthlyCount,
      limit: features.analysisLimit,
    };
  }
  return { allowed: true };
}

export function checkFeatureAccess(plan: string, feature: FeatureKey): PlanGateResult {
  if (isFeatureEnabled(plan, feature)) {
    return { allowed: true };
  }
  const requiredPlan = getRequiredPlan(feature);
  const featureLabels: Record<string, string> = {
    battlecards: "Sales Battlecards",
    recommendations: "AI Recommendations",
    pdfReports: "PDF Reports",
    socialMonitoring: "Social Media Monitoring",
    clientProjects: "Client Projects",
    gtmPlan: "GTM Plan",
    messagingFramework: "Messaging Framework",
    marketingPlanner: "Marketing Planner",
    productManagement: "Product Management",
    multiMarket: "Multi-Market Support",
    websiteMonitoring: "Website Change Monitoring",
    ssoIntegration: "SSO Integration",
    customBranding: "Custom Branding",
  };
  return {
    allowed: false,
    reason: `${featureLabels[feature] || feature} requires a ${requiredPlan} plan or higher.`,
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
