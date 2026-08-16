import { storage } from "../storage";

export interface FeatureDefinition {
  key: string;
  label: string;
  description: string;
  category: "intelligence" | "monitoring" | "planning" | "marketing" | "sales" | "platform";
}

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  { key: "battlecards", label: "Sales Battlecards", description: "Generate competitive battlecards for sales teams", category: "intelligence" },
  { key: "recommendations", label: "AI Recommendations", description: "AI-powered strategic recommendations", category: "intelligence" },
  { key: "pdfReports", label: "PDF Reports", description: "Generate branded PDF competitive reports", category: "intelligence" },
  { key: "gtmPlan", label: "GTM Plan", description: "AI-generated Go-To-Market plans", category: "intelligence" },
  { key: "messagingFramework", label: "Messaging Framework", description: "AI-generated messaging frameworks", category: "intelligence" },
  { key: "relationshipReports", label: "Relationship Reports", description: "On-demand 12-month plans for engaging, cooperating, selling to, competing with, or steering clear of any company", category: "intelligence" },
  { key: "socialMonitoring", label: "Social Media Monitoring", description: "Track competitor social media presence", category: "monitoring" },
  { key: "websiteMonitoring", label: "Website Change Detection", description: "AI-powered website change monitoring", category: "monitoring" },
  { key: "clientProjects", label: "Client Projects", description: "Product-level competitive analysis projects", category: "intelligence" },
  { key: "marketingPlanner", label: "Marketing Planner", description: "AI-powered quarterly/annual marketing planning", category: "planning" },
  { key: "productManagement", label: "Product Management", description: "Roadmap prioritization and feature tracking", category: "planning" },
  { key: "customerFeedback", label: "Customer Feedback & Voting", description: "Collect and prioritize customer feedback with feature voting", category: "planning" },
  { key: "multiMarket", label: "Multi-Market Support", description: "Manage multiple client contexts in one tenant", category: "platform" },
  { key: "ssoIntegration", label: "SSO Integration", description: "Microsoft Entra ID / Google SSO login", category: "platform" },
  { key: "customBranding", label: "Custom Branding", description: "Custom logos, colors, and branded reports", category: "platform" },
  { key: "socialPosts", label: "Social Post Generator", description: "AI-generated social media posts from competitive intelligence", category: "marketing" },
  { key: "emailNewsletters", label: "Email Newsletter Generator", description: "AI-powered email newsletters from market intelligence", category: "marketing" },
  { key: "contentLibrary", label: "Content Library", description: "Manage marketing content assets, categories, and product tags", category: "marketing" },
  { key: "brandLibrary", label: "Brand Library", description: "Manage brand-approved visual assets and templates", category: "marketing" },
  { key: "campaigns", label: "Campaigns", description: "Campaign management with asset and social account coordination", category: "marketing" },
  { key: "editorialCalendar", label: "Editorial Calendar", description: "AI-generated, demand-scored content briefs and editorial calendars grounded in the messaging framework, competitive gaps, personas, and SEO demand", category: "marketing" },
  { key: "contentRepurposing", label: "Content Repurposing", description: "Repurpose a content asset into a batch of brand-aligned social variants written into the posts pipeline", category: "marketing" },
  { key: "seoAeoOptimizer", label: "SEO/AEO Optimizer", description: "Generate search metadata, answer-engine blocks/FAQ, validated internal-link suggestions, and content-gap analysis for a piece of content", category: "marketing" },
  { key: "distributionPlanner", label: "Distribution Planner", description: "Recommend channel + posting-window schedules for editorial-calendar briefs and materialize them into the marketing planner (rides the existing Microsoft Planner sync)", category: "marketing" },
  { key: "marketingPerformance", label: "Marketing Performance", description: "Closed-loop content performance report: per-content attribution from first-party clicks + GA4 conversions, benchmarked against tenant history, emitting recommendations that feed the editorial calendar", category: "marketing" },
  { key: "conferencePromotion", label: "Event Promotion", description: "Drive coordinated social promotion for an event: anchor posts plus a matched post + graphic for every session, with archivable event image space", category: "marketing" },
  { key: "socialAccounts", label: "Social Accounts", description: "Connect and manage social media accounts for publishing", category: "marketing" },
  { key: "saturnCapture", label: "Saturn Capture Extension", description: "Browser extension for capturing web content into the content library", category: "marketing" },
  { key: "salesOutreachCampaigns", label: "Sales Outreach Campaigns", description: "Goal-driven 1:1 outbound: prospect, score, draft personalized outreach in the seller's voice, sequence follow-ups, and manage the campaign — with a human approving every send in Outlook", category: "sales" },
  { key: "outreachInterview", label: "Outreach Campaign Interview", description: "Create an outreach campaign through a guided interview that captures goal, message, target ICP, geography/industry refinements, offering, and call to action", category: "sales" },
  { key: "prospectResearch", label: "Prospect Research & Scoring", description: "Research and ICP-score prospects against the tenant's personas, with an AI dossier per prospect", category: "sales" },
  { key: "outreachComposer", label: "Outreach Composer", description: "Draft personalized email + LinkedIn outreach grounded in the prospect dossier, the seller's personal voice, and competitive objections, with AI-cliché and compliance scanning", category: "sales" },
  { key: "outreachCadence", label: "Outreach Cadence", description: "Sequence follow-ups with reply/send detection, event-anchored timing, and master circuit breakers (incl. stricter LinkedIn limits)", category: "sales" },
  { key: "intelligenceBriefings", label: "Intelligence Briefings", description: "AI-synthesized periodic market intelligence reports with executive summaries", category: "intelligence" },
  { key: "podcastBriefings", label: "Podcast Briefings", description: "AI-generated podcast-style audio summaries of intelligence briefings", category: "intelligence" },
  { key: "scheduledBriefingUpdates", label: "Scheduled Briefing Updates", description: "Automatic weekly briefing generation with email delivery", category: "intelligence" },
  { key: "competitorAlerts", label: "Competitor Change Alerts", description: "Real-time in-app and email alerts when competitors make significant changes", category: "monitoring" },
  { key: "personaBuilder", label: "Persona & ICP Builder", description: "Define buyer personas and inject audience context into AI content", category: "marketing" },
  { key: "autoBuild", label: "Auto Build", description: "Automatically discover competitors, crawl data, and generate full analytics for a new market", category: "platform" },
  { key: "webhookIntegrations", label: "Slack & Teams Notifications", description: "Send tenant-scoped event notifications to Slack and Microsoft Teams via incoming webhooks", category: "platform" },
  { key: "seoTracking", label: "SEO & Share of Voice", description: "Track keyword rankings and competitive share-of-voice over time", category: "monitoring" },
  { key: "directPublishing", label: "Direct Social Publishing", description: "Publish approved scheduled posts directly to LinkedIn (and other platforms as added) instead of exporting CSV", category: "marketing" },
  { key: "directEmailDelivery", label: "Direct Email Campaign Delivery", description: "Send AI-generated emails to managed recipient lists with bounce/unsubscribe handling", category: "marketing" },
  { key: "partnerApi", label: "Partner API & OAuth", description: "OAuth 2.0 partner API for Galaxy and other third-party portals to read user-consented artifacts", category: "platform" },
  { key: "sentimentAnalysis", label: "Sentiment & Tone Analysis", description: "Show competitor content sentiment and tone analysis, plus tone-shift alerts. Analysis always runs server-side; this gate controls UI visibility and alerts only.", category: "intelligence" },
  { key: "outcomeMetrics", label: "Outcome Metrics & Orbit Score", description: "ROI dashboard with Orbit Score, GA4 analytics integration, and outcome trend charts", category: "intelligence" },
  { key: "industryBenchmarks", label: "Industry Benchmarks", description: "Compare your Orbit Score against anonymized SIC-code peer cohorts (≥5 tenants)", category: "intelligence" },
  { key: "competitorDocuments", label: "Competitor Documents", description: "Upload per-competitor PDF/DOCX/TXT documents (datasheets, case studies, annual reports) to ground analyses, gap analysis, battlecards, and briefings", category: "intelligence" },
  { key: "collaboration", label: "Collaboration", description: "Threaded comments, @mentions, shared annotations and action item assignments across artifacts", category: "platform" },
  { key: "hubspotIntegration", label: "HubSpot CRM Sync", description: "Connect a HubSpot portal to enrich competitors with CRM data, surface deal context, and push battlecards / briefings / action items into HubSpot. Pro: inbound only. Enterprise/Unlimited: inbound + outbound + auto-push.", category: "platform" },
  { key: "hubspotEmailSync", label: "HubSpot Marketing Email Sync", description: "Sync marketing-email engagement (sent/open/click/bounce/unsubscribe) to HubSpot contact timelines and keep unsubscribe/subscription status in sync. Requires a connected HubSpot portal with the marketing-email scopes re-authorized.", category: "marketing" },
  { key: "pricingIntelligence", label: "Pricing Intelligence", description: "Track competitor pricing pages with structured tier extraction, change history, and AI-summarised diffs surfaced in activity, battlecards, and the visualization dashboard.", category: "monitoring" },
  { key: "visualizationDashboard", label: "Visualization Dashboard", description: "Interactive Recharts-based dashboard with engagement trends, posting frequency, sentiment over time, and competitor activity analytics.", category: "intelligence" },
  { key: "marketingContacts", label: "Marketing Contacts", description: "First-party contact database with lifecycle stages and activity timeline — the spine for segmentation, nurture, and attribution.", category: "marketing" },
  { key: "leadScoring", label: "Lead Scoring", description: "Rule-based lead scoring with AI-suggested rules, lifecycle stage transitions, and HubSpot score push. Requires Marketing Contacts.", category: "marketing" },
  { key: "marketingWorkflows", label: "Marketing Workflows", description: "Visual multi-step automation engine: enrollment triggers (segment, event, score), email sends, waits, branches, property updates, and notifications.", category: "marketing" },
  { key: "marketSegments", label: "Market Segment Sizing", description: "Promote personas into quantified market segments with AI-estimated TAM/SAM (cited), 1–10 priority scoring, and structured Needs Maps. The strategic-intelligence foundation for the GTM opportunity matrix and market study wizard.", category: "intelligence" },
  { key: "opportunityMatrix", label: "GTM Opportunity Matrix", description: "Rank where to focus GTM first: a scored grid crossing market segments × buyer needs × channels on revenue potential, execution effort, and derived ROI, with whitespace detection. Requires Market Segments.", category: "intelligence" },
  { key: "marketStudyWizard", label: "Market Study Wizard", description: "End-to-end market study from a brief or URL: models segments, sizes TAM/SAM, builds the GTM opportunity matrix, and writes an executive summary — one guided run, saved and refreshable. Requires Market Segments + Opportunity Matrix.", category: "intelligence" },
  { key: "executiveSummary", label: "Unified Executive Summary", description: "On-demand AI-synthesized company briefing spanning market position, where to play, marketing execution, sales development, and recommended executive actions.", category: "intelligence" },
  { key: "executiveSummaryAuto", label: "Scheduled Executive Summary", description: "Automatic weekly generation of the unified executive summary. Requires Unified Executive Summary.", category: "intelligence" },
];

export const FEATURE_CATEGORIES = [
  { key: "intelligence", label: "Competitive Intelligence" },
  { key: "monitoring", label: "Monitoring" },
  { key: "planning", label: "Planning & Management" },
  { key: "marketing", label: "Marketing" },
  { key: "sales", label: "Sales" },
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
    relationshipReports: false,
    marketingPlanner: false,
    productManagement: false,
    customerFeedback: false,
    multiMarket: false,
    websiteMonitoring: false,
    ssoIntegration: false,
    customBranding: false,
    socialPosts: false,
    emailNewsletters: false,
    contentLibrary: false,
    brandLibrary: false,
    campaigns: false,
    editorialCalendar: false,
    contentRepurposing: false,
    seoAeoOptimizer: false,
    distributionPlanner: false,
    marketingPerformance: false,
    conferencePromotion: false,
    socialAccounts: false,
    saturnCapture: false,
    intelligenceBriefings: false,
    podcastBriefings: false,
    scheduledBriefingUpdates: false,
    competitorAlerts: false,
    personaBuilder: false,
    autoBuild: false,
    webhookIntegrations: false,
    seoTracking: false,
    directPublishing: false,
    directEmailDelivery: false,
    partnerApi: false,
    sentimentAnalysis: false,
    outcomeMetrics: false,
    industryBenchmarks: false,
    competitorDocuments: false,
    collaboration: false,
    hubspotIntegration: false,
    hubspotEmailSync: false,
    pricingIntelligence: false,
    visualizationDashboard: false,
    marketingContacts: false,
    leadScoring: false,
    marketingWorkflows: false,
    marketSegments: false,
    opportunityMatrix: false,
    marketStudyWizard: false,
    executiveSummary: false,
    executiveSummaryAuto: false,
  },
  trial: {
    battlecards: true,
    recommendations: true,
    pdfReports: true,
    socialMonitoring: false,
    clientProjects: false,
    gtmPlan: true,
    messagingFramework: true,
    relationshipReports: true,
    marketingPlanner: false,
    productManagement: false,
    customerFeedback: false,
    multiMarket: false,
    websiteMonitoring: false,
    ssoIntegration: false,
    customBranding: false,
    socialPosts: false,
    emailNewsletters: false,
    contentLibrary: false,
    brandLibrary: false,
    campaigns: false,
    editorialCalendar: false,
    contentRepurposing: false,
    seoAeoOptimizer: false,
    distributionPlanner: false,
    marketingPerformance: false,
    conferencePromotion: false,
    socialAccounts: false,
    saturnCapture: false,
    intelligenceBriefings: false,
    podcastBriefings: false,
    scheduledBriefingUpdates: false,
    competitorAlerts: false,
    personaBuilder: false,
    autoBuild: false,
    webhookIntegrations: false,
    seoTracking: false,
    directPublishing: false,
    directEmailDelivery: false,
    partnerApi: false,
    sentimentAnalysis: false,
    outcomeMetrics: false,
    industryBenchmarks: false,
    competitorDocuments: false,
    collaboration: false,
    hubspotIntegration: false,
    hubspotEmailSync: false,
    pricingIntelligence: false,
    visualizationDashboard: false,
    marketingContacts: false,
    leadScoring: false,
    marketingWorkflows: false,
    marketSegments: false,
    opportunityMatrix: false,
    marketStudyWizard: false,
    executiveSummary: false,
    executiveSummaryAuto: false,
  },
  pro: {
    battlecards: true,
    recommendations: true,
    pdfReports: true,
    socialMonitoring: true,
    clientProjects: true,
    gtmPlan: true,
    messagingFramework: true,
    relationshipReports: true,
    marketingPlanner: false,
    productManagement: true,
    customerFeedback: true,
    multiMarket: false,
    websiteMonitoring: true,
    ssoIntegration: true,
    customBranding: false,
    socialPosts: false,
    emailNewsletters: false,
    contentLibrary: false,
    brandLibrary: false,
    campaigns: false,
    editorialCalendar: false,
    contentRepurposing: false,
    seoAeoOptimizer: false,
    distributionPlanner: false,
    marketingPerformance: false,
    conferencePromotion: false,
    socialAccounts: false,
    saturnCapture: false,
    intelligenceBriefings: true,
    podcastBriefings: true,
    scheduledBriefingUpdates: false,
    competitorAlerts: true,
    personaBuilder: true,
    autoBuild: false,
    webhookIntegrations: false,
    seoTracking: true,
    directPublishing: false,
    directEmailDelivery: false,
    partnerApi: false,
    sentimentAnalysis: true,
    outcomeMetrics: true,
    industryBenchmarks: false,
    competitorDocuments: true,
    collaboration: true,
    hubspotIntegration: true,
    hubspotEmailSync: true,
    pricingIntelligence: true,
    visualizationDashboard: false,
    marketingContacts: false,
    leadScoring: false,
    marketingWorkflows: false,
    marketSegments: false,
    opportunityMatrix: false,
    marketStudyWizard: false,
    executiveSummary: true,
    executiveSummaryAuto: true,
  },
  enterprise: {
    battlecards: true,
    recommendations: true,
    pdfReports: true,
    socialMonitoring: true,
    clientProjects: true,
    gtmPlan: true,
    messagingFramework: true,
    relationshipReports: true,
    marketingPlanner: true,
    productManagement: true,
    customerFeedback: true,
    multiMarket: true,
    websiteMonitoring: true,
    ssoIntegration: true,
    customBranding: true,
    socialPosts: true,
    emailNewsletters: true,
    contentLibrary: true,
    brandLibrary: true,
    campaigns: true,
    editorialCalendar: true,
    contentRepurposing: true,
    seoAeoOptimizer: true,
    distributionPlanner: true,
    marketingPerformance: true,
    conferencePromotion: true,
    socialAccounts: true,
    saturnCapture: true,
    intelligenceBriefings: true,
    podcastBriefings: true,
    scheduledBriefingUpdates: true,
    competitorAlerts: true,
    personaBuilder: true,
    autoBuild: true,
    webhookIntegrations: true,
    seoTracking: true,
    directPublishing: true,
    directEmailDelivery: true,
    partnerApi: true,
    sentimentAnalysis: true,
    outcomeMetrics: true,
    industryBenchmarks: true,
    competitorDocuments: true,
    collaboration: true,
    hubspotIntegration: true,
    hubspotEmailSync: true,
    pricingIntelligence: true,
    visualizationDashboard: true,
    salesOutreachCampaigns: true,
    outreachInterview: true,
    prospectResearch: true,
    outreachComposer: true,
    outreachCadence: true,
    marketingContacts: true,
    leadScoring: true,
    marketingWorkflows: true,
    marketSegments: true,
    opportunityMatrix: true,
    marketStudyWizard: true,
    executiveSummary: true,
    executiveSummaryAuto: true,
  },
  unlimited: {
    battlecards: true,
    recommendations: true,
    pdfReports: true,
    socialMonitoring: true,
    clientProjects: true,
    gtmPlan: true,
    messagingFramework: true,
    relationshipReports: true,
    marketingPlanner: true,
    productManagement: true,
    customerFeedback: true,
    multiMarket: true,
    websiteMonitoring: true,
    ssoIntegration: true,
    customBranding: true,
    socialPosts: true,
    emailNewsletters: true,
    contentLibrary: true,
    brandLibrary: true,
    campaigns: true,
    editorialCalendar: true,
    contentRepurposing: true,
    seoAeoOptimizer: true,
    distributionPlanner: true,
    marketingPerformance: true,
    conferencePromotion: true,
    socialAccounts: true,
    saturnCapture: true,
    intelligenceBriefings: true,
    podcastBriefings: true,
    scheduledBriefingUpdates: true,
    competitorAlerts: true,
    personaBuilder: true,
    autoBuild: true,
    webhookIntegrations: true,
    seoTracking: true,
    directPublishing: true,
    directEmailDelivery: true,
    partnerApi: true,
    sentimentAnalysis: true,
    outcomeMetrics: true,
    industryBenchmarks: true,
    competitorDocuments: true,
    collaboration: true,
    hubspotIntegration: true,
    hubspotEmailSync: true,
    pricingIntelligence: true,
    visualizationDashboard: true,
    salesOutreachCampaigns: true,
    outreachInterview: true,
    prospectResearch: true,
    outreachComposer: true,
    outreachCadence: true,
    marketingContacts: true,
    leadScoring: true,
    marketingWorkflows: true,
    marketSegments: true,
    opportunityMatrix: true,
    marketStudyWizard: true,
    executiveSummary: true,
    executiveSummaryAuto: true,
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

const PLAN_ALIASES: Record<string, string> = {
  professional: "pro",
};

export function normalizePlanName(plan: string): string {
  return PLAN_ALIASES[plan] || plan;
}

const PLAN_TIER_ORDER = ["free", "trial", "pro", "enterprise"];

export function nextPlanForLimit(currentPlan: string): string {
  const normalized = normalizePlanName(currentPlan);
  const idx = PLAN_TIER_ORDER.indexOf(normalized);
  if (idx === -1 || idx >= PLAN_TIER_ORDER.length - 1) return "Enterprise";
  const next = PLAN_TIER_ORDER[idx + 1];
  return next.charAt(0).toUpperCase() + next.slice(1);
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
  planName = normalizePlanName(planName);
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
  planName = normalizePlanName(planName);
  if (planName === "unlimited") return buildUnlimitedFeatures();
  const fallbackLimits = DEFAULT_PLAN_LIMITS[planName] || DEFAULT_PLAN_LIMITS.free;
  const fallbackFeatures = DEFAULT_PLAN_FEATURES[planName] || DEFAULT_PLAN_FEATURES.free;
  return { ...fallbackLimits, ...fallbackFeatures };
}

/**
 * Resolve the *effective* plan tier for a tenant.
 *
 * Stripe is the source of truth when billing is not manually managed:
 *   - Manual billing → trust the persisted plan column (admin-pinned).
 *   - Active or trialing Stripe subscription → trust the persisted plan
 *     (kept in sync by the webhook handler).
 *   - In payment grace window → keep the persisted paid plan.
 *   - Otherwise, paid persisted tiers are downgraded to "free" at read time
 *     so feature gates respect cancellation immediately, even before the
 *     hourly grace sweep runs.
 */
export function resolveEffectivePlan(tenant: {
  plan?: string | null;
  subscriptionStatus?: string | null;
  stripeSubscriptionId?: string | null;
  paymentGraceUntil?: Date | string | null;
  billingManagedManually?: boolean | null;
}): string {
  const persisted = (tenant.plan || "free").toLowerCase();
  if (tenant.billingManagedManually) return persisted;

  // If there's no Stripe subscription at all, trust the persisted plan.
  // Only apply Stripe-based downgrade logic when a subscription was
  // actually set up (i.e. the tenant went through Stripe checkout at
  // some point). This ensures directly-assigned plans (e.g. evaluation
  // tenants, internal orgs) are never downgraded.
  if (!tenant.stripeSubscriptionId) return persisted;

  const status = (tenant.subscriptionStatus || "").toLowerCase();
  const hasPaid = status === "active" || status === "trialing";

  let inGrace = false;
  if (tenant.paymentGraceUntil) {
    const until =
      tenant.paymentGraceUntil instanceof Date
        ? tenant.paymentGraceUntil
        : new Date(tenant.paymentGraceUntil);
    inGrace = !Number.isNaN(until.getTime()) && until.getTime() > Date.now();
  }

  const isPaidTier = ["pro", "professional", "enterprise", "unlimited"].includes(
    persisted,
  );
  if (isPaidTier && !hasPaid && !inGrace) return "free";
  return persisted;
}

export function isFeatureEnabled(plan: string, feature: FeatureKey): boolean {
  plan = normalizePlanName(plan);
  if (plan === "unlimited") return true;
  const features = getPlanFeatures(plan);
  return features[feature] === true;
}

export async function isFeatureEnabledAsync(plan: string, feature: FeatureKey): Promise<boolean> {
  plan = normalizePlanName(plan);
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
      requiredPlan: nextPlanForLimit(plan),
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
      requiredPlan: nextPlanForLimit(plan),
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
      requiredPlan: nextPlanForLimit(plan),
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
      requiredPlan: nextPlanForLimit(plan),
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

// ===== Manual Action Quotas (Task #99) =====
// Per-tenant monthly caps for cost-driving manual actions. -1 = unlimited.
export type ManualActionKey =
  | "linkedinRefresh"
  | "manualCrawl"
  | "manualWebsiteMonitor"
  | "seoSweep"
  | "regenerateAll"
  | "aiResearch"
  | "aiFeatureExtract"
  | "aiPostGen"
  | "aiEmailGen"
  | "aiPersonaGen"
  | "manualBriefingRebuild"
  | "manualBattlecardRegen"
  | "pricingRefresh"
  | "runOutreachInterview"
  | "generateProspectDossier"
  | "discoverProspects"
  | "enrichProspectContact"
  | "generateOutreachDraft"
  | "runMarketSizing"
  | "generateOpportunityMatrix"
  | "runMarketStudy";

export const MANUAL_ACTION_LABELS: Record<ManualActionKey, string> = {
  linkedinRefresh: "LinkedIn Refresh",
  manualCrawl: "Manual Competitor Crawl",
  manualWebsiteMonitor: "Manual Website Monitor",
  seoSweep: "SEO Refresh Sweep",
  regenerateAll: "Regenerate All Analytics",
  aiResearch: "AI Research",
  aiFeatureExtract: "AI Feature Extraction",
  aiPostGen: "AI Social Post Generation",
  aiEmailGen: "AI Email Generation",
  aiPersonaGen: "AI Persona Generation",
  manualBriefingRebuild: "Manual Briefing Rebuild",
  manualBattlecardRegen: "Manual Battlecard Regeneration",
  pricingRefresh: "Pricing Snapshot Refresh",
  runOutreachInterview: "Outreach Campaign Interview",
  generateProspectDossier: "Prospect Research & Scoring",
  discoverProspects: "Prospect Discovery (web)",
  enrichProspectContact: "Prospect Contact Enrichment",
  generateOutreachDraft: "Outreach Draft Generation",
  runMarketSizing: "Market Segment Sizing (TAM/SAM)",
  generateOpportunityMatrix: "GTM Opportunity Matrix Generation",
  runMarketStudy: "Market Study Wizard Run",
};

export const MANUAL_ACTION_KEYS: ManualActionKey[] = Object.keys(MANUAL_ACTION_LABELS) as ManualActionKey[];

// Cost tier per action — recorded in audit log so finance/ops can group spend by intensity.
export const MANUAL_ACTION_COST_TIERS: Record<ManualActionKey, "low" | "medium" | "high"> = {
  linkedinRefresh: "low",
  manualCrawl: "medium",
  manualWebsiteMonitor: "low",
  seoSweep: "high",
  regenerateAll: "high",
  aiResearch: "high",
  aiFeatureExtract: "medium",
  aiPostGen: "medium",
  aiEmailGen: "medium",
  aiPersonaGen: "medium",
  manualBriefingRebuild: "high",
  manualBattlecardRegen: "medium",
  pricingRefresh: "medium",
  runOutreachInterview: "medium",
  generateProspectDossier: "high",
  discoverProspects: "high",
  enrichProspectContact: "high",
  generateOutreachDraft: "medium",
  // Web-search-grounded TAM/SAM estimation — highest-cost intelligence action.
  runMarketSizing: "high",
  // Fans out AI scoring across segments × needs × channels.
  generateOpportunityMatrix: "high",
  // End-to-end pipeline: segment modeling + sizing + matrix + summary.
  runMarketStudy: "high",
};

const MANUAL_ACTION_QUOTAS: Record<string, Record<ManualActionKey, number>> = {
  free: {
    linkedinRefresh: 0,
    manualCrawl: 1,
    manualWebsiteMonitor: 0,
    seoSweep: 0,
    regenerateAll: 0,
    aiResearch: 1,
    aiFeatureExtract: 1,
    aiPostGen: 0,
    aiEmailGen: 0,
    aiPersonaGen: 0,
    manualBriefingRebuild: 0,
    manualBattlecardRegen: 0,
    pricingRefresh: 0,
    runOutreachInterview: 0,
    generateProspectDossier: 0,
    discoverProspects: 0,
    enrichProspectContact: 0,
    generateOutreachDraft: 0,
    runMarketSizing: 0,
    generateOpportunityMatrix: 0,
    runMarketStudy: 0,
  },
  trial: {
    linkedinRefresh: 5,
    manualCrawl: 10,
    manualWebsiteMonitor: 5,
    seoSweep: 3,
    regenerateAll: 2,
    aiResearch: 10,
    aiFeatureExtract: 10,
    aiPostGen: 10,
    aiEmailGen: 10,
    aiPersonaGen: 5,
    manualBriefingRebuild: 3,
    manualBattlecardRegen: 5,
    pricingRefresh: 0,
    runOutreachInterview: 0,
    generateProspectDossier: 0,
    discoverProspects: 0,
    enrichProspectContact: 0,
    generateOutreachDraft: 0,
    runMarketSizing: 0,
    generateOpportunityMatrix: 0,
    runMarketStudy: 0,
  },
  pro: {
    linkedinRefresh: 25,
    manualCrawl: 50,
    manualWebsiteMonitor: 25,
    seoSweep: 15,
    regenerateAll: 10,
    aiResearch: 50,
    aiFeatureExtract: 50,
    aiPostGen: 50,
    aiEmailGen: 50,
    aiPersonaGen: 25,
    manualBriefingRebuild: 15,
    manualBattlecardRegen: 25,
    pricingRefresh: 25,
    runOutreachInterview: 0,
    generateProspectDossier: 0,
    discoverProspects: 0,
    enrichProspectContact: 0,
    generateOutreachDraft: 0,
    runMarketSizing: 0,
    generateOpportunityMatrix: 0,
    runMarketStudy: 0,
  },
  enterprise: {
    linkedinRefresh: 100,
    manualCrawl: 200,
    manualWebsiteMonitor: 100,
    seoSweep: 50,
    regenerateAll: 30,
    aiResearch: 200,
    aiFeatureExtract: 200,
    aiPostGen: 200,
    aiEmailGen: 200,
    aiPersonaGen: 100,
    manualBriefingRebuild: 50,
    manualBattlecardRegen: 100,
    pricingRefresh: 100,
    runOutreachInterview: 100,
    generateProspectDossier: 200,
    discoverProspects: 100,
    enrichProspectContact: 100,
    generateOutreachDraft: 200,
    runMarketSizing: 100,
    generateOpportunityMatrix: 50,
    runMarketStudy: 25,
  },
  unlimited: {
    linkedinRefresh: -1,
    manualCrawl: -1,
    manualWebsiteMonitor: -1,
    seoSweep: -1,
    regenerateAll: -1,
    aiResearch: -1,
    aiFeatureExtract: -1,
    aiPostGen: -1,
    aiEmailGen: -1,
    aiPersonaGen: -1,
    manualBriefingRebuild: -1,
    manualBattlecardRegen: -1,
    pricingRefresh: -1,
    runOutreachInterview: -1,
    generateProspectDossier: -1,
    discoverProspects: -1,
    enrichProspectContact: -1,
    generateOutreachDraft: -1,
    runMarketSizing: -1,
    generateOpportunityMatrix: -1,
    runMarketStudy: -1,
  },
};

export function getManualActionQuota(plan: string, action: ManualActionKey): number {
  const normalized = normalizePlanName(plan);
  const quotas = MANUAL_ACTION_QUOTAS[normalized] || MANUAL_ACTION_QUOTAS.free;
  const limit = quotas[action];
  return typeof limit === "number" ? limit : 0;
}

export function getAllManualActionQuotas(plan: string): Record<ManualActionKey, number> {
  const normalized = normalizePlanName(plan);
  return MANUAL_ACTION_QUOTAS[normalized] || MANUAL_ACTION_QUOTAS.free;
}

export function nextPlanForManualAction(currentPlan: string, action: ManualActionKey): string {
  const normalized = normalizePlanName(currentPlan);
  const idx = PLAN_TIER_ORDER.indexOf(normalized);
  for (let i = Math.max(idx, 0) + 1; i < PLAN_TIER_ORDER.length; i++) {
    const candidate = PLAN_TIER_ORDER[i];
    const limit = getManualActionQuota(candidate, action);
    if (limit === -1 || limit > getManualActionQuota(currentPlan, action)) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }
  return "Enterprise";
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
          const merged = { ...existingFeatures };
          for (const k of missingKeys) {
            merged[k] = defaultFeatures[k];
          }

          const forceTrueKeys: string[] = [];
          if (def.name === "pro" && merged.outcomeMetrics !== true) {
            merged.outcomeMetrics = true;
            forceTrueKeys.push("outcomeMetrics");
          }

          if (missingKeys.length > 0 || forceTrueKeys.length > 0) {
            await storage.updateServicePlan(existing.id, { features: merged } as any);
            if (missingKeys.length > 0) {
              console.log(`[Plan Seed] Synced ${missingKeys.length} new feature(s) for plan ${def.displayName}: ${missingKeys.join(", ")}`);
            }
            if (forceTrueKeys.length > 0) {
              console.log(`[Plan Seed] Force-enabled ${forceTrueKeys.length} feature(s) for plan ${def.displayName}: ${forceTrueKeys.join(", ")}`);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[Plan Seed] Error seeding plan ${def.name}:`, err.message);
    }
  }
}
