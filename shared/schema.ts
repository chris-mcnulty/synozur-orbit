import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, jsonb, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("Standard User"),
  company: text("company").notNull(),
  companySize: text("company_size"),
  jobTitle: text("job_title"),
  industry: text("industry"),
  country: text("country"),
  avatar: text("avatar").notNull(),
  entraId: text("entra_id"),
  authProvider: text("auth_provider").default("local"),
  emailVerified: boolean("email_verified").default(false),
  status: text("status").default("active"), // active, pending_verification, suspended
  weeklyDigestEnabled: boolean("weekly_digest_enabled").default(true), // Opt-in for weekly competitor digest emails
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  company: text("company").notNull(),
  entraId: text("entra_id"),
  azureTenantId: text("azure_tenant_id"),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  userId: varchar("user_id").notNull().references(() => users.id),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tenantInvites = pgTable("tenant_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  tenantDomain: text("tenant_domain").notNull(),
  invitedRole: text("invited_role").notNull().default("Standard User"),
  invitedBy: varchar("invited_by").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"), // pending, accepted, expired, revoked
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  domain: text("domain").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("trial"), // trial, free, pro, enterprise
  status: text("status").notNull().default("active"),
  trialStartDate: timestamp("trial_start_date"), // When trial period began
  trialEndsAt: timestamp("trial_ends_at"), // When trial period expires (60 days from start)
  lastTrialReminderSent: text("last_trial_reminder_sent"), // Track which reminder was last sent: day7, day30, day46, day53, day57, day59, day60
  userCount: integer("user_count").notNull().default(0),
  competitorLimit: integer("competitor_limit").notNull().default(3),
  analysisLimit: integer("analysis_limit").notNull().default(5),
  adminUserLimit: integer("admin_user_limit").notNull().default(1),
  readWriteUserLimit: integer("read_write_user_limit").notNull().default(2),
  readOnlyUserLimit: integer("read_only_user_limit").notNull().default(5),
  monitoringFrequency: text("monitoring_frequency").default("weekly"), // weekly, daily, disabled
  socialMonitoringEnabled: boolean("social_monitoring_enabled").default(false), // Premium feature
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: text("primary_color").default("#810FFB"),
  secondaryColor: text("secondary_color").default("#E60CB3"),
  // Tenant-level Entra ID configuration (Domain Admin editable)
  entraClientId: text("entra_client_id"), // Azure AD App Registration Client ID
  entraTenantId: text("entra_tenant_id"), // Azure AD Tenant ID
  entraClientSecret: text("entra_client_secret"), // Azure AD App Registration Client Secret (encrypted)
  entraEnabled: boolean("entra_enabled").default(false), // Whether tenant-level Entra SSO is enabled
  // Multi-market settings (Enterprise tier feature)
  multiMarketEnabled: boolean("multi_market_enabled").default(false), // Whether tenant can create multiple markets
  marketLimit: integer("market_limit"), // Maximum number of markets allowed (NULL = unlimited)
  // SharePoint Embedded (SPE) file storage — tenant-level container configuration
  speContainerIdDev: text("spe_container_id_dev"), // SPE container ID for development environment
  speContainerIdProd: text("spe_container_id_prod"), // SPE container ID for production environment
  speStorageEnabled: boolean("spe_storage_enabled").default(false), // Whether SPE storage is active for this tenant
  speMigrationStatus: text("spe_migration_status"), // pending | in_progress | completed | failed
  speMigrationStartedAt: timestamp("spe_migration_started_at"), // When SPE migration began
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const domainBlocklist = pgTable("domain_blocklist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  domain: text("domain").notNull().unique(),
  reason: text("reason"), // e.g., "Personal email provider", "Generic domain"
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Service Plans - defines plan templates with default limits
export const servicePlans = pgTable("service_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // e.g., "trial", "free", "pro", "enterprise"
  displayName: text("display_name").notNull(), // e.g., "Trial", "Free", "Pro", "Enterprise"
  description: text("description"),
  // Usage limits
  competitorLimit: integer("competitor_limit").notNull().default(3),
  analysisLimit: integer("analysis_limit").notNull().default(5),
  // User limits
  adminUserLimit: integer("admin_user_limit").notNull().default(1),
  readWriteUserLimit: integer("read_write_user_limit").notNull().default(2),
  readOnlyUserLimit: integer("read_only_user_limit").notNull().default(5),
  // Multi-market settings
  multiMarketEnabled: boolean("multi_market_enabled").notNull().default(false),
  marketLimit: integer("market_limit"), // NULL = unlimited
  // Premium features - Monitoring controls
  monitoringFrequency: text("monitoring_frequency").default("weekly"), // weekly, daily, disabled (controls website crawls)
  socialMonitoringEnabled: boolean("social_monitoring_enabled").default(false),
  websiteMonitorEnabled: boolean("website_monitor_enabled").default(false), // AI-powered website change detection
  productMonitorEnabled: boolean("product_monitor_enabled").default(false), // Standalone product URL monitoring
  // Feature access flags - flexible JSONB for easy extensibility
  // Keys are feature identifiers, values are booleans. See FEATURE_REGISTRY in plan-policy.ts.
  features: jsonb("features").notNull().default({}),
  // Trial settings
  trialDays: integer("trial_days"), // Only applicable for trial plan
  // Pricing (for display purposes)
  monthlyPrice: integer("monthly_price"), // In cents, NULL = free or contact sales
  annualPrice: integer("annual_price"), // In cents, NULL = free or contact sales
  // Status
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false), // Default plan for new signups
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertServicePlanSchema = createInsertSchema(servicePlans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertServicePlan = z.infer<typeof insertServicePlanSchema>;
export type ServicePlan = typeof servicePlans.$inferSelect;

// Markets - a "market" is a context containing a baseline company, competitors, and projects
// Enterprise tenants can have multiple markets for different client work
export const markets = pgTable("markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  status: text("status").notNull().default("active"), // active, archived
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Consultant access grants - allows consultants to access specific tenants
export const consultantAccess = pgTable("consultant_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"), // active, revoked
  grantedBy: varchar("granted_by").notNull().references(() => users.id),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clientProjects = pgTable("client_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // e.g., "Rightpoint Q1 2026 Analysis"
  clientName: text("client_name").notNull(), // e.g., "Rightpoint"
  clientDomain: text("client_domain"), // optional: rightpoint.com
  description: text("description"),
  analysisType: text("analysis_type").notNull().default("company"), // company, product
  status: text("status").notNull().default("active"), // active, completed, archived
  notifyOnUpdates: boolean("notify_on_updates").default(false), // Notify when competitor site/social updates detected
  tenantDomain: text("tenant_domain").notNull(), // owner tenant (e.g., synozur.com)
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context (nullable for migration)
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  url: text("url"), // Product page URL
  companyName: text("company_name"), // Company that makes this product
  competitorId: varchar("competitor_id").references(() => competitors.id, { onDelete: "set null" }), // Optional link to competitor
  companyProfileId: varchar("company_profile_id").references(() => companyProfiles.id, { onDelete: "set null" }), // Link to baseline company (for your products)
  isBaseline: boolean("is_baseline").default(false), // True for your products, false for competitor products
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context (nullable for migration)
  createdBy: varchar("created_by").notNull().references(() => users.id),
  crawlData: jsonb("crawl_data"), // Crawled product page data
  analysisData: jsonb("analysis_data"), // AI analysis of product
  linkedInUrl: text("linkedin_url"), // Product-specific LinkedIn page
  instagramUrl: text("instagram_url"), // Product-specific Instagram
  twitterUrl: text("twitter_url"), // Product-specific Twitter/X
  socialCheckFrequency: text("social_check_frequency").default("daily"), // hourly, daily, weekly
  lastSocialCrawl: timestamp("last_social_crawl"), // When social was last checked
  previousWebsiteContent: text("previous_website_content"), // Previous crawl content for change detection
  lastWebsiteMonitor: timestamp("last_website_monitor"), // When website was last monitored for changes
  competitivePositionSummary: text("competitive_position_summary"), // AI-generated 2-3 sentence summary of competitive positioning
  summaryGeneratedAt: timestamp("summary_generated_at"), // When the summary was last generated
  excludeFromCrawl: boolean("exclude_from_crawl").notNull().default(false),
  consecutiveCrawlFailures: integer("consecutive_crawl_failures").notNull().default(0),
  crawlFlaggedAt: timestamp("crawl_flagged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Product Features - for tracking product capabilities
export const productFeatures = pgTable("product_features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"), // e.g., Security, Analytics, UX, Integration
  status: text("status").notNull().default("planned"), // backlog, planned, in_progress, released
  priority: text("priority").default("medium"), // high, medium, low
  targetQuarter: text("target_quarter"), // Q1, Q2, Q3, Q4 or null
  targetYear: integer("target_year"),
  competitorParity: jsonb("competitor_parity"), // JSON array of competitor IDs that have similar features
  sourceType: text("source_type").notNull().default("manual"), // manual, csv, parsed, scraped
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Roadmap Items - for product roadmap management
export const roadmapItems = pgTable("roadmap_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  featureId: varchar("feature_id").references(() => productFeatures.id, { onDelete: "set null" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  quarter: text("quarter"), // Q1, Q2, Q3, Q4, or null for unscheduled
  year: integer("year"),
  effort: text("effort"), // xs, s, m, l, xl
  status: text("status").notNull().default("planned"), // planned, in_progress, completed, deferred
  aiRecommended: boolean("ai_recommended").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Feature Recommendations - AI-generated suggestions
export const featureRecommendations = pgTable("feature_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  type: text("type").notNull(), // gap, opportunity, priority, risk
  title: text("title").notNull(),
  explanation: text("explanation").notNull(), // Detailed AI rationale
  relatedCompetitors: jsonb("related_competitors"), // JSON array of competitor IDs
  suggestedPriority: text("suggested_priority"), // high, medium, low
  suggestedQuarter: text("suggested_quarter"),
  status: text("status").notNull().default("pending"), // pending, accepted, dismissed
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projectProducts = pgTable("project_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => clientProjects.id, { onDelete: "cascade" }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("competitor"), // baseline, competitor, optional
  source: text("source").notNull().default("manual"), // manual, suggested
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  canonicalDomain: text("canonical_domain").notNull().unique(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  status: text("status").notNull().default("active"),
  faviconUrl: text("favicon_url"),
  screenshotUrl: text("screenshot_url"),
  linkedInUrl: text("linkedin_url"),
  instagramUrl: text("instagram_url"),
  twitterUrl: text("twitter_url"),
  blogUrl: text("blog_url"),
  headquarters: text("headquarters"),
  founded: text("founded"),
  employeeCount: text("employee_count"),
  revenue: text("revenue"),
  fundingRaised: text("funding_raised"),
  industry: text("industry"),
  crawlData: jsonb("crawl_data"),
  previousWebsiteContent: text("previous_website_content"),
  linkedInContent: text("linkedin_content"),
  instagramContent: text("instagram_content"),
  twitterContent: text("twitter_content"),
  linkedInEngagement: jsonb("linkedin_engagement"),
  instagramEngagement: jsonb("instagram_engagement"),
  twitterEngagement: jsonb("twitter_engagement"),
  blogSnapshot: jsonb("blog_snapshot"),
  lastFullCrawl: timestamp("last_full_crawl"),
  lastWebsiteMonitor: timestamp("last_website_monitor"),
  lastSocialCrawl: timestamp("last_social_crawl"),
  lastCrawl: text("last_crawl"),
  archivedAt: timestamp("archived_at"),
  deletedAt: timestamp("deleted_at"),
  activeReferenceCount: integer("active_reference_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

export const competitors = pgTable("competitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  linkedInUrl: text("linkedin_url"),
  instagramUrl: text("instagram_url"),
  twitterUrl: text("twitter_url"), // Twitter/X profile URL
  blogUrl: text("blog_url"), // Blog or RSS feed URL
  faviconUrl: text("favicon_url"), // URL to stored favicon/logo
  screenshotUrl: text("screenshot_url"), // URL to stored homepage screenshot
  lastCrawl: text("last_crawl"),
  lastSocialCrawl: timestamp("last_social_crawl"),
  linkedInContent: text("linkedin_content"), // Last crawled LinkedIn page content for diff (messaging only)
  instagramContent: text("instagram_content"), // Last crawled Instagram page content for diff (messaging only)
  twitterContent: text("twitter_content"), // Last crawled Twitter/X page content for diff
  linkedInEngagement: jsonb("linkedin_engagement"), // Snapshot: {followers, posts, reactions, comments}
  instagramEngagement: jsonb("instagram_engagement"), // Snapshot: {followers, posts, likes, comments}
  twitterEngagement: jsonb("twitter_engagement"), // Snapshot: {followers, tweets, retweets, likes}
  blogSnapshot: jsonb("blog_snapshot"), // Snapshot: {postCount, latestTitles, capturedAt}
  crawlData: jsonb("crawl_data"), // Multi-page crawl results: {pages[], totalWordCount, crawledAt}
  lastFullCrawl: timestamp("last_full_crawl"), // Timestamp of last multi-page crawl
  previousWebsiteContent: text("previous_website_content"), // Previous crawl content for change detection
  lastWebsiteMonitor: timestamp("last_website_monitor"), // Timestamp of last website change monitoring
  socialCheckFrequency: text("social_check_frequency").notNull().default("daily"), // "hourly", "daily", "weekly"
  excludeFromCrawl: boolean("exclude_from_crawl").notNull().default(false),
  status: text("status").notNull().default("Active"),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  tenantDomain: text("tenant_domain"),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context (nullable for migration)
  projectId: varchar("project_id").references(() => clientProjects.id, { onDelete: "set null" }), // Optional: for client project work
  analysisData: jsonb("analysis_data"), // AI analysis results
  // Company profile fields (for battlecard capsule overview)
  headquarters: text("headquarters"), // City, State/Country
  founded: text("founded"), // Year founded
  employeeCount: text("employee_count"), // Approximate number or range, e.g., "50-100" or "500+"
  revenue: text("revenue"), // Revenue range or estimate (e.g., "$10M-$50M", "Series B")
  fundingRaised: text("funding_raised"), // Total funding raised (e.g., "$25M")
  industry: text("industry"), // Industry/sector
  consecutiveCrawlFailures: integer("consecutive_crawl_failures").notNull().default(0),
  crawlFlaggedAt: timestamp("crawl_flagged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const activity = pgTable("activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // change, new_page, blog_post, social_update, product_update
  sourceType: text("source_type").notNull().default("competitor"), // competitor | baseline
  competitorId: varchar("competitor_id").references(() => competitors.id, { onDelete: "cascade" }), // Nullable for baseline activity
  companyProfileId: varchar("company_profile_id").references(() => companyProfiles.id, { onDelete: "cascade" }), // For baseline activity
  competitorName: text("competitor_name").notNull(), // Display name (works for both competitor and baseline)
  description: text("description").notNull(), // Brief description
  summary: text("summary"), // AI-generated summary of what changed
  details: jsonb("details"), // Structured data: {oldContent, newContent, pagesAffected[], blogTitles[], etc.}
  date: text("date").notNull(),
  impact: text("impact").notNull(),
  userId: varchar("user_id").references(() => users.id),
  tenantDomain: text("tenant_domain"),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const recommendations = pgTable("recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  area: text("area").notNull(),
  impact: text("impact").notNull(),
  status: text("status").notNull().default("pending"), // pending, accepted, dismissed
  assignedTo: varchar("assigned_to").references(() => users.id),
  dismissedAt: timestamp("dismissed_at"),
  acceptedAt: timestamp("accepted_at"),
  competitorId: varchar("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
  productId: varchar("product_id").references(() => products.id, { onDelete: "set null" }),
  projectId: varchar("project_id").references(() => clientProjects.id, { onDelete: "set null" }),
  userId: varchar("user_id").references(() => users.id),
  tenantDomain: text("tenant_domain"),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  // Feedback and prioritization
  thumbsUp: integer("thumbs_up").notNull().default(0),
  thumbsDown: integer("thumbs_down").notNull().default(0),
  isPriority: boolean("is_priority").notNull().default(false),
  // Soft hide with duplicate prevention
  dedupeKey: text("dedupe_key"), // Normalized key for duplicate detection
  dismissedReason: text("dismissed_reason"), // already_done, not_relevant, duplicate, other
  dismissedBy: varchar("dismissed_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  date: text("date").notNull(),
  type: text("type").notNull(),
  size: text("size").notNull(),
  author: text("author").notNull(),
  status: text("status").notNull(),
  scope: text("scope").notNull().default("baseline"), // "baseline" | "project"
  projectId: varchar("project_id").references(() => clientProjects.id),
  tenantDomain: text("tenant_domain"),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  createdBy: varchar("created_by").references(() => users.id),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const analysis = pgTable("analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  tenantDomain: text("tenant_domain"),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  themes: jsonb("themes").notNull(),
  messaging: jsonb("messaging").notNull(),
  gaps: jsonb("gaps").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const battlecards = pgTable("battlecards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  competitorId: varchar("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  strengths: jsonb("strengths"), // Array of competitor strengths
  weaknesses: jsonb("weaknesses"), // Array of competitor weaknesses
  ourAdvantages: jsonb("our_advantages"), // How we beat this competitor
  comparison: jsonb("comparison"), // Harvey ball feature comparison: [{category, us, them, notes}]
  objections: jsonb("objections"), // Common objections and responses: [{objection, response}]
  talkTracks: jsonb("talk_tracks"), // Sales conversation guides: [{scenario, script}]
  quickStats: jsonb("quick_stats"), // {pricing, marketPosition, targetAudience, keyProducts}
  customNotes: text("custom_notes"), // Free-form notes
  status: text("status").notNull().default("draft"), // draft, published
  lastGeneratedAt: timestamp("last_generated_at"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const productBattlecards = pgTable("product_battlecards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  baselineProductId: varchar("baseline_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  competitorProductId: varchar("competitor_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull().references(() => clientProjects.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  strengths: jsonb("strengths"), // Array of competitor product strengths
  weaknesses: jsonb("weaknesses"), // Array of competitor product weaknesses
  ourAdvantages: jsonb("our_advantages"), // How our product beats this competitor
  keyDifferentiators: jsonb("key_differentiators"), // [{feature, ours, theirs}]
  objections: jsonb("objections"), // Common objections and responses: [{objection, response}]
  talkTracks: jsonb("talk_tracks"), // Sales conversation guides: [{scenario, script}]
  featureComparison: jsonb("feature_comparison"), // {feature: {ours: bool/text, theirs: bool/text}}
  customNotes: text("custom_notes"), // Free-form notes
  status: text("status").notNull().default("draft"), // draft, published
  lastGeneratedAt: timestamp("last_generated_at"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Long-form AI-generated recommendations (GTM plan, messaging framework)
export const longFormRecommendations = pgTable("long_form_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // gtm_plan, messaging_framework
  // Scope: can be for a project (product analysis) or company profile (company analysis)
  projectId: varchar("project_id").references(() => clientProjects.id, { onDelete: "cascade" }),
  companyProfileId: varchar("company_profile_id").references(() => companyProfiles.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  // The generated content (markdown format)
  content: text("content"),
  // Saved prompts/parameters for regeneration
  savedPrompts: jsonb("saved_prompts"), // {targetRoles: [], distributionChannels: [], customGuidance: string, ...}
  // Status tracking
  status: text("status").notNull().default("not_generated"), // not_generated, generating, generated
  lastGeneratedAt: timestamp("last_generated_at"),
  generatedBy: varchar("generated_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  competitors: many(competitors),
}));

export const competitorsRelations = relations(competitors, ({ one, many }) => ({
  user: one(users, {
    fields: [competitors.userId],
    references: [users.id],
  }),
  activities: many(activity),
}));

export const activityRelations = relations(activity, ({ one }) => ({
  competitor: one(competitors, {
    fields: [activity.competitorId],
    references: [competitors.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompetitorSchema = createInsertSchema(competitors).omit({
  id: true,
  createdAt: true,
  lastCrawl: true,
});

export const insertActivitySchema = createInsertSchema(activity).omit({
  id: true,
  createdAt: true,
});

export const insertRecommendationSchema = createInsertSchema(recommendations).omit({
  id: true,
  createdAt: true,
});

export const insertReportSchema = createInsertSchema(reports).omit({
  id: true,
  createdAt: true,
});

export const insertAnalysisSchema = createInsertSchema(analysis).omit({
  id: true,
  createdAt: true,
});

export const insertEmailVerificationTokenSchema = createInsertSchema(emailVerificationTokens).omit({
  id: true,
  createdAt: true,
  used: true,
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  createdAt: true,
  used: true,
});

export const insertTenantInviteSchema = createInsertSchema(tenantInvites).omit({
  id: true,
  createdAt: true,
  acceptedAt: true,
});

export const insertDomainBlocklistSchema = createInsertSchema(domainBlocklist).omit({
  id: true,
  createdAt: true,
});

export const insertMarketSchema = createInsertSchema(markets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertConsultantAccessSchema = createInsertSchema(consultantAccess).omit({
  id: true,
  createdAt: true,
  grantedAt: true,
  revokedAt: true,
});

export const insertClientProjectSchema = createInsertSchema(clientProjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectProductSchema = createInsertSchema(projectProducts).omit({
  id: true,
  createdAt: true,
});

export const insertProductFeatureSchema = createInsertSchema(productFeatures).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRoadmapItemSchema = createInsertSchema(roadmapItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFeatureRecommendationSchema = createInsertSchema(featureRecommendations).omit({
  id: true,
  createdAt: true,
});

export const insertBattlecardSchema = createInsertSchema(battlecards).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastGeneratedAt: true,
});

export const insertProductBattlecardSchema = createInsertSchema(productBattlecards).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastGeneratedAt: true,
});

export const insertLongFormRecommendationSchema = createInsertSchema(longFormRecommendations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;
export type InsertEmailVerificationToken = z.infer<typeof insertEmailVerificationTokenSchema>;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertTenantInvite = z.infer<typeof insertTenantInviteSchema>;
export type TenantInvite = typeof tenantInvites.$inferSelect;
export type InsertDomainBlocklist = z.infer<typeof insertDomainBlocklistSchema>;
export type DomainBlocklist = typeof domainBlocklist.$inferSelect;
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type Market = typeof markets.$inferSelect;
export type InsertConsultantAccess = z.infer<typeof insertConsultantAccessSchema>;
export type ConsultantAccess = typeof consultantAccess.$inferSelect;
export type InsertClientProject = z.infer<typeof insertClientProjectSchema>;
export type ClientProject = typeof clientProjects.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;
export type InsertProjectProduct = z.infer<typeof insertProjectProductSchema>;
export type ProjectProduct = typeof projectProducts.$inferSelect;
export type InsertProductFeature = z.infer<typeof insertProductFeatureSchema>;
export type ProductFeature = typeof productFeatures.$inferSelect;
export type InsertRoadmapItem = z.infer<typeof insertRoadmapItemSchema>;
export type RoadmapItem = typeof roadmapItems.$inferSelect;
export type InsertFeatureRecommendation = z.infer<typeof insertFeatureRecommendationSchema>;
export type FeatureRecommendation = typeof featureRecommendations.$inferSelect;
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;
export type Competitor = typeof competitors.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activity.$inferSelect;
export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type Recommendation = typeof recommendations.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reports.$inferSelect;
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analysis.$inferSelect;
export type InsertBattlecard = z.infer<typeof insertBattlecardSchema>;
export type Battlecard = typeof battlecards.$inferSelect;
export type InsertProductBattlecard = z.infer<typeof insertProductBattlecardSchema>;
export type ProductBattlecard = typeof productBattlecards.$inferSelect;
export type InsertLongFormRecommendation = z.infer<typeof insertLongFormRecommendationSchema>;
export type LongFormRecommendation = typeof longFormRecommendations.$inferSelect;

// Chat tables for AI conversations
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// Grounding documents table for AI context
export const GROUNDING_DOC_CONTEXTS = [
  "competitive_analysis",
  "recommendations",
  "executive_summary",
  "intelligence_briefing",
  "marketing_content",
  "email_generation",
] as const;

export const GROUNDING_DOC_CONTEXT_LABELS: Record<string, string> = {
  competitive_analysis: "Competitive Analysis",
  recommendations: "Recommendations",
  executive_summary: "Executive Summary",
  intelligence_briefing: "Intelligence Briefing",
  marketing_content: "Social Posts & Content Summaries",
  email_generation: "Email Generation",
};

export const GROUNDING_DOC_CONTEXT_PRESETS: Record<string, string[]> = {
  all: [...GROUNDING_DOC_CONTEXTS],
  intelligence: ["competitive_analysis", "recommendations", "executive_summary", "intelligence_briefing"],
  marketing: ["marketing_content", "email_generation"],
};

export const groundingDocuments = pgTable("grounding_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  fileType: text("file_type").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull(),
  extractedText: text("extracted_text"),
  scope: text("scope").notNull().default("tenant"),
  useCase: text("use_case").notNull().default("intelligence"),
  contexts: jsonb("contexts").$type<string[]>(),
  competitorId: varchar("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  speFileId: text("spe_file_id"),
  speContainerId: text("spe_container_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const groundingDocumentsRelations = relations(groundingDocuments, ({ one }) => ({
  user: one(users, {
    fields: [groundingDocuments.userId],
    references: [users.id],
  }),
  competitor: one(competitors, {
    fields: [groundingDocuments.competitorId],
    references: [competitors.id],
  }),
}));

export const insertGroundingDocumentSchema = createInsertSchema(groundingDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type GroundingDocument = typeof groundingDocuments.$inferSelect;
export type InsertGroundingDocument = z.infer<typeof insertGroundingDocumentSchema>;

// Global grounding documents - application-wide AI context (Global Admin only)
export const globalGroundingDocuments = pgTable("global_grounding_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(), // brand_voice, marketing_guidelines, digital_assets, methodology, etc.
  fileType: text("file_type").notNull(), // pdf, docx, txt, md
  originalFileName: text("original_file_name").notNull(),
  extractedText: text("extracted_text").notNull(), // Extracted text content - we only store this to save space
  wordCount: integer("word_count").notNull().default(0),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id),
  isActive: boolean("is_active").notNull().default(true), // Can disable without deleting
  // SharePoint Embedded — drive-item ID when stored in SPE (null = not in SPE)
  speFileId: text("spe_file_id"),
  speContainerId: text("spe_container_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const globalGroundingDocumentsRelations = relations(globalGroundingDocuments, ({ one }) => ({
  uploader: one(users, {
    fields: [globalGroundingDocuments.uploadedBy],
    references: [users.id],
  }),
}));

export const insertGlobalGroundingDocumentSchema = createInsertSchema(globalGroundingDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type GlobalGroundingDocument = typeof globalGroundingDocuments.$inferSelect;
export type InsertGlobalGroundingDocument = z.infer<typeof insertGlobalGroundingDocumentSchema>;

// Company profiles table for baselining own website
// In multi-market mode, each market has its own company profile (baseline)
export const companyProfiles = pgTable("company_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  tenantDomain: text("tenant_domain").notNull(),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context - each market has its baseline
  companyName: text("company_name").notNull(),
  websiteUrl: text("website_url").notNull(),
  logoUrl: text("logo_url"), // Company logo URL (uploaded or external)
  linkedInUrl: text("linkedin_url"),
  instagramUrl: text("instagram_url"),
  twitterUrl: text("twitter_url"), // Twitter/X profile URL
  blogUrl: text("blog_url"), // Blog or RSS feed URL for baseline company
  description: text("description"),
  // Directory fields - stable columns for company information
  headquarters: text("headquarters"), // City, State/Country
  founded: text("founded"), // Year founded
  employeeCount: text("employee_count"), // Employee count or range
  industry: text("industry"), // Industry/sector
  revenue: text("revenue"), // Revenue range
  fundingRaised: text("funding_raised"), // Total funding raised (e.g., "$25M")
  lastAnalysis: timestamp("last_analysis"),
  analysisData: jsonb("analysis_data"),
  lastCrawl: text("last_crawl"),
  lastSocialCrawl: timestamp("last_social_crawl"),
  linkedInContent: text("linkedin_content"),
  instagramContent: text("instagram_content"),
  twitterContent: text("twitter_content"),
  linkedInEngagement: jsonb("linkedin_engagement"),
  instagramEngagement: jsonb("instagram_engagement"),
  twitterEngagement: jsonb("twitter_engagement"),
  blogSnapshot: jsonb("blog_snapshot"),
  crawlData: jsonb("crawl_data"),
  lastFullCrawl: timestamp("last_full_crawl"),
  previousWebsiteContent: text("previous_website_content"),
  lastWebsiteMonitor: timestamp("last_website_monitor"),
  socialCheckFrequency: text("social_check_frequency").notNull().default("daily"), // "hourly", "daily", "weekly"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const companyProfilesRelations = relations(companyProfiles, ({ one }) => ({
  user: one(users, {
    fields: [companyProfiles.userId],
    references: [users.id],
  }),
}));

export const insertCompanyProfileSchema = createInsertSchema(companyProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastAnalysis: true,
  analysisData: true,
});

export type CompanyProfile = typeof companyProfiles.$inferSelect;
export type InsertCompanyProfile = z.infer<typeof insertCompanyProfileSchema>;

// Assessments table for saving analysis snapshots
export const assessments = pgTable("assessments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  userId: varchar("user_id").notNull().references(() => users.id),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  // Snapshot of analysis at time of assessment
  companyProfileSnapshot: jsonb("company_profile_snapshot"),
  competitorsSnapshot: jsonb("competitors_snapshot").notNull(),
  analysisSnapshot: jsonb("analysis_snapshot").notNull(),
  recommendationsSnapshot: jsonb("recommendations_snapshot"),
  // Proxy assessment fields (following Orion pattern)
  isProxy: boolean("is_proxy").notNull().default(false),
  proxyName: text("proxy_name"),
  proxyCompany: text("proxy_company"),
  proxyJobTitle: text("proxy_job_title"),
  proxyIndustry: text("proxy_industry"),
  proxyCompanySize: text("proxy_company_size"),
  proxyCountry: text("proxy_country"),
  // Status and timestamps
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const assessmentsRelations = relations(assessments, ({ one }) => ({
  user: one(users, {
    fields: [assessments.userId],
    references: [users.id],
  }),
}));

export const insertAssessmentSchema = createInsertSchema(assessments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Assessment = typeof assessments.$inferSelect;
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;

// Page views for traffic analytics
export const pageViews = pgTable("page_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  path: text("path").notNull(), // e.g., "/", "/auth/signup"
  sessionId: text("session_id").notNull(), // anonymous session tracking
  ipHash: text("ip_hash"), // hashed IP for unique visitor counting
  userAgent: text("user_agent"),
  referrer: text("referrer"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  country: text("country"), // IP geolocation country code
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPageViewSchema = createInsertSchema(pageViews).omit({
  id: true,
  createdAt: true,
});

export type PageView = typeof pageViews.$inferSelect;
export type InsertPageView = z.infer<typeof insertPageViewSchema>;

// Competitor/Product scores for ranking and comparison
// Supports both company-level competitors and standalone products
export const competitorScores = pgTable("competitor_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  competitorId: varchar("competitor_id").references(() => competitors.id, { onDelete: "cascade" }), // Nullable for standalone products
  productId: varchar("product_id").references(() => products.id, { onDelete: "cascade" }), // For product-level scoring
  projectId: varchar("project_id").references(() => clientProjects.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  entityName: text("entity_name"), // Cached name for display (competitor or product name)
  overallScore: integer("overall_score").notNull().default(0), // 0-100 composite score
  marketPresenceScore: integer("market_presence_score").default(0), // 0-100
  innovationScore: integer("innovation_score").default(0), // 0-100
  pricingScore: integer("pricing_score").default(0), // 0-100
  featureBreadthScore: integer("feature_breadth_score").default(0), // 0-100
  contentActivityScore: integer("content_activity_score").default(0), // 0-100
  socialEngagementScore: integer("social_engagement_score").default(0), // 0-100
  trendDirection: text("trend_direction").default("stable"), // rising, falling, stable
  trendDelta: integer("trend_delta").default(0), // Change in overall score from last period
  previousOverallScore: integer("previous_overall_score"), // For trend calculation
  scoreBreakdown: jsonb("score_breakdown"), // Detailed breakdown for UI display
  lastCalculatedAt: timestamp("last_calculated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const competitorScoresRelations = relations(competitorScores, ({ one }) => ({
  competitor: one(competitors, {
    fields: [competitorScores.competitorId],
    references: [competitors.id],
  }),
  product: one(products, {
    fields: [competitorScores.productId],
    references: [products.id],
  }),
  project: one(clientProjects, {
    fields: [competitorScores.projectId],
    references: [clientProjects.id],
  }),
}));

export const insertCompetitorScoreSchema = createInsertSchema(competitorScores).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastCalculatedAt: true,
});

export type CompetitorScore = typeof competitorScores.$inferSelect;
export type InsertCompetitorScore = z.infer<typeof insertCompetitorScoreSchema>;

// Social metrics time series for trend tracking
export const socialMetrics = pgTable("social_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  competitorId: varchar("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  platform: text("platform").notNull(), // linkedin, instagram, twitter, blog
  period: text("period").notNull(), // weekly, daily snapshot identifier (e.g., "2026-W03")
  followers: integer("followers").default(0),
  followersDelta: integer("followers_delta").default(0), // Change from previous period
  posts: integer("posts").default(0),
  postsDelta: integer("posts_delta").default(0),
  engagement: integer("engagement").default(0), // Total likes, comments, shares
  engagementDelta: integer("engagement_delta").default(0),
  mentions: integer("mentions").default(0), // Brand mentions (if tracked)
  mentionsDelta: integer("mentions_delta").default(0),
  rawData: jsonb("raw_data"), // Full platform-specific metrics
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const socialMetricsRelations = relations(socialMetrics, ({ one }) => ({
  competitor: one(competitors, {
    fields: [socialMetrics.competitorId],
    references: [competitors.id],
  }),
}));

export const insertSocialMetricSchema = createInsertSchema(socialMetrics).omit({
  id: true,
  createdAt: true,
  capturedAt: true,
});

export type SocialMetric = typeof socialMetrics.$inferSelect;
export type InsertSocialMetric = z.infer<typeof insertSocialMetricSchema>;

// Score history for tracking Orbit Scores over time (competitors and baselines)
export const scoreHistory = pgTable("score_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: text("entity_type").notNull(), // "competitor" or "baseline"
  entityId: varchar("entity_id").notNull(), // competitorId or companyProfileId
  entityName: text("entity_name").notNull(), // Cached name for display
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  projectId: varchar("project_id").references(() => clientProjects.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score").notNull(), // 0-100
  innovationScore: integer("innovation_score").default(0),
  marketPresenceScore: integer("market_presence_score").default(0),
  contentActivityScore: integer("content_activity_score").default(0),
  socialEngagementScore: integer("social_engagement_score").default(0),
  scoreBreakdown: jsonb("score_breakdown"), // Full breakdown for analysis
  period: text("period").notNull(), // e.g., "2026-01", "2026-W04" 
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const scoreHistoryRelations = relations(scoreHistory, ({ one }) => ({
  project: one(clientProjects, {
    fields: [scoreHistory.projectId],
    references: [clientProjects.id],
  }),
  market: one(markets, {
    fields: [scoreHistory.marketId],
    references: [markets.id],
  }),
}));

export const insertScoreHistorySchema = createInsertSchema(scoreHistory).omit({
  id: true,
  createdAt: true,
  recordedAt: true,
});

export type ScoreHistory = typeof scoreHistory.$inferSelect;
export type InsertScoreHistory = z.infer<typeof insertScoreHistorySchema>;

// Executive summary cache for fast dashboard loading
export const executiveSummaries = pgTable("executive_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => clientProjects.id, { onDelete: "cascade" }),
  companyProfileId: varchar("company_profile_id").references(() => companyProfiles.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }), // Market context
  scope: text("scope").notNull().default("baseline"), // baseline or project
  // 4-part executive summary sections
  companySnapshot: text("company_snapshot"), // 1-2 sentence company overview + key facts
  marketPosition: text("market_position"), // Score vs competitors + comparative insights
  competitiveLandscape: text("competitive_landscape"), // Top competitors + themes/gaps
  opportunities: text("opportunities"), // Top recommendations + actions
  // Editing/locking support
  lockedSections: jsonb("locked_sections").default([]), // Array of locked section names
  dataHash: text("data_hash"), // Hash of source data to detect changes
  // Legacy fields for backwards compatibility
  summaryData: jsonb("summary_data"), // Aggregated executive summary payload
  topCompetitors: jsonb("top_competitors"), // Ranked list of top competitors with scores
  keyInsights: jsonb("key_insights"), // AI-generated key insights
  alertItems: jsonb("alert_items"), // Items needing attention (rising competitors, gaps)
  lastGeneratedAt: timestamp("last_generated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const executiveSummariesRelations = relations(executiveSummaries, ({ one }) => ({
  project: one(clientProjects, {
    fields: [executiveSummaries.projectId],
    references: [clientProjects.id],
  }),
  companyProfile: one(companyProfiles, {
    fields: [executiveSummaries.companyProfileId],
    references: [companyProfiles.id],
  }),
}));

export const insertExecutiveSummarySchema = createInsertSchema(executiveSummaries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastGeneratedAt: true,
});

export type ExecutiveSummary = typeof executiveSummaries.$inferSelect;
export type InsertExecutiveSummary = z.infer<typeof insertExecutiveSummarySchema>;

// ═══════════════════════════════════════════════════════════════════════════
// AI Provider & Model Management
// Multi-provider support with per-function model assignments.
// Providers: Replit AI (Anthropic/OpenAI), Azure AI Foundry
// ═══════════════════════════════════════════════════════════════════════════

export const AI_PROVIDERS = {
  REPLIT_ANTHROPIC: 'replit_anthropic',
  REPLIT_OPENAI: 'replit_openai',
  AZURE_FOUNDRY: 'azure_foundry',
} as const;

export type AIProviderKey = typeof AI_PROVIDERS[keyof typeof AI_PROVIDERS];

export const AI_FEATURES = {
  COMPETITOR_ANALYSIS: 'competitor_analysis',
  GAP_ANALYSIS: 'gap_analysis',
  RECOMMENDATIONS: 'recommendations',
  BATTLECARD: 'battlecard',
  GTM_PLAN: 'gtm_plan',
  MESSAGING_FRAMEWORK: 'messaging_framework',
  CHANGE_DETECTION: 'change_detection',
  INTELLIGENCE_BRIEFING: 'intelligence_briefing',
  ROADMAP_RECOMMENDATIONS: 'roadmap_recommendations',
  FEATURE_EXTRACTION: 'feature_extraction',
  PRODUCT_ONE_SHEET: 'product_one_sheet',
  MARKETING_TASKS: 'marketing_tasks',
} as const;

export type AIFeature = typeof AI_FEATURES[keyof typeof AI_FEATURES];

export const AI_FEATURE_LABELS: Record<AIFeature, string> = {
  competitor_analysis: 'Competitor Website Analysis',
  gap_analysis: 'Gap Analysis',
  recommendations: 'Recommendations',
  battlecard: 'Battlecard Generation',
  gtm_plan: 'GTM Plan Generation',
  messaging_framework: 'Messaging Framework',
  change_detection: 'Website Change Detection',
  intelligence_briefing: 'Intelligence Briefing',
  roadmap_recommendations: 'Product Roadmap Recommendations',
  feature_extraction: 'Feature Extraction',
  product_one_sheet: 'Product One-Sheet',
  marketing_tasks: 'Marketing Task Generation',
};

export const AI_MODELS: Record<string, readonly string[]> = {
  replit_anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-sonnet-4', 'claude-opus-4'],
  replit_openai: ['gpt-4o', 'gpt-4o-mini'],
  azure_foundry: ['gpt-5.4', 'gpt-5.2', 'gpt-4o', 'mistral-large', 'cohere-command-r-plus', 'meta-llama-3.1-405b'],
} as const;

export type AzureFoundryEndpointType = 'aoai' | 'inference';

export const AZURE_FOUNDRY_MODEL_ENDPOINT: Record<string, AzureFoundryEndpointType> = {
  'gpt-5.4': 'aoai',
  'gpt-5.2': 'aoai',
  'gpt-4o': 'aoai',
  'mistral-large': 'inference',
  'cohere-command-r-plus': 'inference',
  'meta-llama-3.1-405b': 'inference',
};

export const AI_MODEL_INFO: Record<string, {
  name: string;
  description: string;
  costTier: 'free' | 'low' | 'medium' | 'high';
  providers: string[];
  contextWindow: number;
  costPer1kPrompt: number;
  costPer1kCompletion: number;
  endpointType?: AzureFoundryEndpointType;
}> = {
  'gpt-5.4': { name: 'GPT-5.4', description: 'Latest and most capable OpenAI model', costTier: 'high', providers: ['azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.005, costPer1kCompletion: 0.015, endpointType: 'aoai' },
  'gpt-5.2': { name: 'GPT-5.2', description: 'Advanced reasoning OpenAI model', costTier: 'high', providers: ['azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.005, costPer1kCompletion: 0.015, endpointType: 'aoai' },
  'gpt-4o': { name: 'GPT-4o', description: 'Fast multimodal model', costTier: 'medium', providers: ['replit_openai', 'azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.0025, costPer1kCompletion: 0.01 },
  'gpt-4o-mini': { name: 'GPT-4o Mini', description: 'Cost-effective for simple tasks', costTier: 'low', providers: ['replit_openai'], contextWindow: 128000, costPer1kPrompt: 0.00015, costPer1kCompletion: 0.0006 },
  'mistral-large': { name: 'Mistral Large', description: 'Mistral flagship model via Azure Foundry', costTier: 'medium', providers: ['azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.002, costPer1kCompletion: 0.006, endpointType: 'inference' },
  'cohere-command-r-plus': { name: 'Cohere Command R+', description: 'Cohere enterprise model via Azure Foundry', costTier: 'medium', providers: ['azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.0025, costPer1kCompletion: 0.01, endpointType: 'inference' },
  'meta-llama-3.1-405b': { name: 'Meta Llama 3.1 405B', description: 'Meta open-weight flagship model via Azure Foundry', costTier: 'medium', providers: ['azure_foundry'], contextWindow: 128000, costPer1kPrompt: 0.00533, costPer1kCompletion: 0.016, endpointType: 'inference' },
  'claude-sonnet-4-5': { name: 'Claude Sonnet 4.5', description: 'Balanced intelligence and speed', costTier: 'medium', providers: ['replit_anthropic'], contextWindow: 200000, costPer1kPrompt: 0.003, costPer1kCompletion: 0.015 },
  'claude-haiku-4-5': { name: 'Claude Haiku 4.5', description: 'Fast and cost-effective', costTier: 'low', providers: ['replit_anthropic'], contextWindow: 200000, costPer1kPrompt: 0.0008, costPer1kCompletion: 0.004 },
  'claude-sonnet-4': { name: 'Claude Sonnet 4', description: 'Previous generation balanced model', costTier: 'medium', providers: ['replit_anthropic'], contextWindow: 200000, costPer1kPrompt: 0.003, costPer1kCompletion: 0.015 },
  'claude-opus-4': { name: 'Claude Opus 4', description: 'Most capable Claude model', costTier: 'high', providers: ['replit_anthropic'], contextWindow: 200000, costPer1kPrompt: 0.015, costPer1kCompletion: 0.075 },
};

export const AI_PROVIDER_LABELS: Record<string, string> = {
  replit_anthropic: 'Replit AI (Anthropic)',
  replit_openai: 'Replit AI (OpenAI)',
  azure_foundry: 'Azure AI Foundry',
};

export const aiConfiguration = pgTable("ai_configuration", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  defaultProvider: text("default_provider").notNull().default('replit_anthropic'),
  defaultModel: text("default_model").notNull().default('claude-sonnet-4-5'),
  maxTokensPerRequest: integer("max_tokens_per_request").default(8192),
  monthlyTokenBudget: integer("monthly_token_budget"),
  alertThresholds: jsonb("alert_thresholds").$type<number[]>().default([75, 90, 100]),
  alertEnabled: boolean("alert_enabled").default(true),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAiConfigurationSchema = createInsertSchema(aiConfiguration).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiConfiguration = z.infer<typeof insertAiConfigurationSchema>;
export type AiConfiguration = typeof aiConfiguration.$inferSelect;

export const aiFeatureModelAssignments = pgTable("ai_feature_model_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  feature: text("feature").notNull().unique(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  maxTokens: integer("max_tokens"),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAiFeatureModelAssignmentSchema = createInsertSchema(aiFeatureModelAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiFeatureModelAssignment = z.infer<typeof insertAiFeatureModelAssignmentSchema>;
export type AiFeatureModelAssignment = typeof aiFeatureModelAssignments.$inferSelect;

export const aiUsageAlerts = pgTable("ai_usage_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodMonth: varchar("period_month", { length: 7 }).notNull(),
  thresholdPercent: integer("threshold_percent").notNull(),
  tokenUsageAtAlert: integer("token_usage_at_alert").notNull(),
  monthlyBudget: integer("monthly_budget").notNull(),
  alertedAt: timestamp("alerted_at").notNull().defaultNow(),
  notifiedEmails: jsonb("notified_emails").$type<string[]>(),
});

export const insertAiUsageAlertSchema = createInsertSchema(aiUsageAlerts).omit({
  id: true,
  alertedAt: true,
});
export type InsertAiUsageAlert = z.infer<typeof insertAiUsageAlertSchema>;
export type AiUsageAlert = typeof aiUsageAlerts.$inferSelect;

// AI Usage tracking for monitoring API costs across tenants
export const aiUsage = pgTable("ai_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain"), // null for system-level calls
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  provider: text("provider").notNull(), // openai, anthropic
  model: text("model").notNull(), // gpt-4o, claude-3-5-sonnet, etc.
  operation: text("operation").notNull(), // analyze_competitor, generate_battlecard, etc.
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCost: text("estimated_cost"), // Stored as string to avoid floating point issues
  durationMs: integer("duration_ms"), // How long the API call took
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"), // Additional context like competitor name, project id, etc.
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAiUsageSchema = createInsertSchema(aiUsage).omit({
  id: true,
  createdAt: true,
});

export type AiUsage = typeof aiUsage.$inferSelect;
export type InsertAiUsage = z.infer<typeof insertAiUsageSchema>;

// Marketing Plans - Enterprise feature for GTM task management
export const marketingPlans = pgTable("marketing_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  fiscalYear: text("fiscal_year").notNull(), // e.g., "2026"
  description: text("description"),
  configMatrix: jsonb("config_matrix"), // Stores activity group × timeframe × priority selections
  status: text("status").notNull().default("draft"), // draft, active, archived
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const marketingPlansRelations = relations(marketingPlans, ({ many }) => ({
  tasks: many(marketingTasks),
}));

export const insertMarketingPlanSchema = createInsertSchema(marketingPlans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MarketingPlan = typeof marketingPlans.$inferSelect;
export type InsertMarketingPlan = z.infer<typeof insertMarketingPlanSchema>;

// Marketing Tasks - Individual tasks within a marketing plan
export const marketingTasks = pgTable("marketing_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull().references(() => marketingPlans.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  activityGroup: text("activity_group").notNull(), // Themes, Digital, Outbound, Partners, Events
  timeframe: text("timeframe").notNull(), // Ongoing, Q1, Q2, Q3, Q4, Future
  priority: text("priority").notNull().default("Medium"), // High, Medium, Low
  status: text("status").notNull().default("suggested"), // suggested, accepted, in_progress, completed, removed
  aiGenerated: boolean("ai_generated").notNull().default(true),
  sourceRecommendationId: varchar("source_recommendation_id").references(() => recommendations.id, { onDelete: "set null" }),
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
  dueDate: timestamp("due_date"),
  plannerTaskId: text("planner_task_id"), // Microsoft Planner task ID for sync
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const marketingTasksRelations = relations(marketingTasks, ({ one }) => ({
  plan: one(marketingPlans, {
    fields: [marketingTasks.planId],
    references: [marketingPlans.id],
  }),
  sourceRecommendation: one(recommendations, {
    fields: [marketingTasks.sourceRecommendationId],
    references: [recommendations.id],
  }),
  assignee: one(users, {
    fields: [marketingTasks.assignedTo],
    references: [users.id],
  }),
}));

export const insertMarketingTaskSchema = createInsertSchema(marketingTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MarketingTask = typeof marketingTasks.$inferSelect;
export type InsertMarketingTask = z.infer<typeof insertMarketingTaskSchema>;

// Intelligence Briefings - AI-synthesized periodic intelligence reports
export const intelligenceBriefings = pgTable("intelligence_briefings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  status: text("status").notNull().default("draft"), // draft, published
  briefingData: jsonb("briefing_data"), // Full AI-synthesized briefing: narrative, signals, themes, action items
  signalCount: integer("signal_count").notNull().default(0),
  competitorCount: integer("competitor_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertIntelligenceBriefingSchema = createInsertSchema(intelligenceBriefings).omit({
  id: true,
  createdAt: true,
});

export type IntelligenceBriefing = typeof intelligenceBriefings.$inferSelect;
export type InsertIntelligenceBriefing = z.infer<typeof insertIntelligenceBriefingSchema>;

// Scheduled Job Runs - Track background job execution history
export const scheduledJobRuns = pgTable("scheduled_job_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobType: text("job_type").notNull(), // websiteCrawl, socialMonitor, websiteMonitor, trialReminder, weeklyDigest
  tenantDomain: text("tenant_domain"), // null for system-wide jobs
  targetId: varchar("target_id"), // competitorId, companyProfileId, etc.
  targetName: text("target_name"), // Human-readable name
  status: text("status").notNull().default("pending"), // pending, running, completed, failed
  result: jsonb("result"), // Structured result data
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertScheduledJobRunSchema = createInsertSchema(scheduledJobRuns).omit({
  id: true,
  createdAt: true,
});

export type ScheduledJobRun = typeof scheduledJobRuns.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// Saturn Marketing Integration
// Content library, brand library, campaigns, social accounts, post/email
// generation — all Enterprise-gated, tenant + market scoped.
// ═══════════════════════════════════════════════════════════════════════════

// Content Asset Categories — labels for organizing content assets
export const contentAssetCategories = pgTable("content_asset_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertContentAssetCategorySchema = createInsertSchema(contentAssetCategories).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type ContentAssetCategory = typeof contentAssetCategories.$inferSelect;
export type InsertContentAssetCategory = z.infer<typeof insertContentAssetCategorySchema>;

// Marketing Product Tags — tag assets and campaigns by product/service
export const marketingProductTags = pgTable("marketing_product_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMarketingProductTagSchema = createInsertSchema(marketingProductTags).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type MarketingProductTag = typeof marketingProductTags.$inferSelect;
export type InsertMarketingProductTag = z.infer<typeof insertMarketingProductTagSchema>;

// Content Assets — marketing content items (copy, articles, slides, etc.)
export const contentAssets = pgTable("content_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  url: text("url"),
  content: text("content"),
  aiSummary: text("ai_summary"),
  leadImageUrl: text("lead_image_url"),
  extractionStatus: text("extraction_status").default("none"),
  fileUrl: text("file_url"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  categoryId: varchar("category_id").references(() => contentAssetCategories.id, { onDelete: "set null" }),
  productIds: text("product_ids").array(),
  tags: jsonb("tags").$type<{ seasons?: string[]; locations?: string[]; topics?: string[] }>(),
  status: text("status").notNull().default("active"),
  capturedViaExtension: boolean("captured_via_extension").notNull().default(false),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const contentAssetsRelations = relations(contentAssets, ({ one, many }) => ({
  category: one(contentAssetCategories, {
    fields: [contentAssets.categoryId],
    references: [contentAssetCategories.id],
  }),
  createdByUser: one(users, {
    fields: [contentAssets.createdBy],
    references: [users.id],
  }),
  productTagLinks: many(contentAssetProductTags),
  campaignAssets: many(campaignAssets),
}));

export const insertContentAssetSchema = createInsertSchema(contentAssets).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type ContentAsset = typeof contentAssets.$inferSelect;
export type InsertContentAsset = z.infer<typeof insertContentAssetSchema>;

// Content Asset ↔ Product Tag join
export const contentAssetProductTags = pgTable("content_asset_product_tags", {
  assetId: varchar("asset_id").notNull().references(() => contentAssets.id, { onDelete: "cascade" }),
  tagId: varchar("tag_id").notNull().references(() => marketingProductTags.id, { onDelete: "cascade" }),
});

// Brand Asset Categories
export const brandAssetCategories = pgTable("brand_asset_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBrandAssetCategorySchema = createInsertSchema(brandAssetCategories).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type BrandAssetCategory = typeof brandAssetCategories.$inferSelect;
export type InsertBrandAssetCategory = z.infer<typeof insertBrandAssetCategorySchema>;

// Brand Assets — approved logos, images, templates, brand-locked visuals
export const brandAssets = pgTable("brand_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  url: text("url"),
  fileUrl: text("file_url"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  categoryId: varchar("category_id").references(() => brandAssetCategories.id, { onDelete: "set null" }),
  productIds: text("product_ids").array(),
  tags: jsonb("tags").$type<{ seasons?: string[]; locations?: string[]; topics?: string[] }>(),
  sourceContentAssetId: varchar("source_content_asset_id").references(() => contentAssets.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const brandAssetsRelations = relations(brandAssets, ({ one, many }) => ({
  category: one(brandAssetCategories, {
    fields: [brandAssets.categoryId],
    references: [brandAssetCategories.id],
  }),
  createdByUser: one(users, {
    fields: [brandAssets.createdBy],
    references: [users.id],
  }),
  productTagLinks: many(brandAssetProductTags),
}));

export const insertBrandAssetSchema = createInsertSchema(brandAssets).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type BrandAsset = typeof brandAssets.$inferSelect;
export type InsertBrandAsset = z.infer<typeof insertBrandAssetSchema>;

// Brand Asset ↔ Product Tag join
export const brandAssetProductTags = pgTable("brand_asset_product_tags", {
  assetId: varchar("asset_id").notNull().references(() => brandAssets.id, { onDelete: "cascade" }),
  tagId: varchar("tag_id").notNull().references(() => marketingProductTags.id, { onDelete: "cascade" }),
});

// Social Accounts — connected social media accounts for publishing
export const socialAccounts = pgTable("social_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  platform: text("platform").notNull(), // linkedin, twitter, instagram, facebook
  accountName: text("account_name").notNull(), // Display name / handle
  accountId: text("account_id"), // Platform-specific ID
  profileUrl: text("profile_url"),
  notes: text("notes"),
  status: text("status").notNull().default("active"), // active, inactive
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSocialAccountSchema = createInsertSchema(socialAccounts).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type SocialAccount = typeof socialAccounts.$inferSelect;
export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;

// Campaigns — group assets + social accounts for coordinated content creation
export const campaigns = pgTable("campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"), // draft, active, completed, archived
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  numberOfDays: integer("number_of_days"),
  includeSaturday: boolean("include_saturday").notNull().default(false),
  includeSunday: boolean("include_sunday").notNull().default(false),
  productIds: text("product_ids").array(),
  alwaysHashtags: jsonb("always_hashtags").$type<string[]>().default([]),
  postGenerationJobId: varchar("post_generation_job_id").references(() => scheduledJobRuns.id, { onDelete: "set null" }),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [campaigns.createdBy],
    references: [users.id],
  }),
  campaignAssets: many(campaignAssets),
  campaignSocialAccounts: many(campaignSocialAccounts),
  generatedPosts: many(generatedPosts),
  generatedEmails: many(generatedEmails),
}));

export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;

// Campaign ↔ Content Asset join (with optional overrides)
export const campaignAssets = pgTable("campaign_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  assetId: varchar("asset_id").notNull().references(() => contentAssets.id, { onDelete: "cascade" }),
  overrideTitle: text("override_title"), // Optional per-campaign title override
  overrideContent: text("override_content"), // Optional per-campaign content override
  sortOrder: integer("sort_order").notNull().default(0),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const campaignAssetsRelations = relations(campaignAssets, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignAssets.campaignId],
    references: [campaigns.id],
  }),
  asset: one(contentAssets, {
    fields: [campaignAssets.assetId],
    references: [contentAssets.id],
  }),
}));

export const insertCampaignAssetSchema = createInsertSchema(campaignAssets).omit({
  id: true, addedAt: true,
});
export type CampaignAsset = typeof campaignAssets.$inferSelect;
export type InsertCampaignAsset = z.infer<typeof insertCampaignAssetSchema>;

// Campaign ↔ Social Account join
export const campaignSocialAccounts = pgTable("campaign_social_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  socialAccountId: varchar("social_account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const campaignSocialAccountsRelations = relations(campaignSocialAccounts, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignSocialAccounts.campaignId],
    references: [campaigns.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [campaignSocialAccounts.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const insertCampaignSocialAccountSchema = createInsertSchema(campaignSocialAccounts).omit({
  id: true, addedAt: true,
});
export type CampaignSocialAccount = typeof campaignSocialAccounts.$inferSelect;
export type InsertCampaignSocialAccount = z.infer<typeof insertCampaignSocialAccountSchema>;

// Generated Posts — AI-generated social posts per campaign × social account
export const generatedPosts = pgTable("generated_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  socialAccountId: varchar("social_account_id").references(() => socialAccounts.id, { onDelete: "set null" }),
  tenantDomain: text("tenant_domain").notNull(),
  platform: text("platform").notNull(), // linkedin, twitter, instagram, facebook
  content: text("content").notNull(), // Generated post copy
  hashtags: jsonb("hashtags").$type<string[]>().default([]),
  imagePrompt: text("image_prompt"), // Suggested image generation prompt
  overrideImageUrl: text("override_image_url"),
  overrideBrandAssetId: varchar("override_brand_asset_id").references(() => brandAssets.id, { onDelete: "set null" }),
  variantGroup: text("variant_group"),
  scheduledDate: timestamp("scheduled_date"),
  status: text("status").notNull().default("draft"), // draft, approved, exported, deleted, rejected
  editedContent: text("edited_content"), // User-edited version of the post
  generationJobId: varchar("generation_job_id").references(() => scheduledJobRuns.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const generatedPostsRelations = relations(generatedPosts, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [generatedPosts.campaignId],
    references: [campaigns.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [generatedPosts.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const insertGeneratedPostSchema = createInsertSchema(generatedPosts).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type GeneratedPost = typeof generatedPosts.$inferSelect;
export type InsertGeneratedPost = z.infer<typeof insertGeneratedPostSchema>;

// Generated Emails — AI-generated promotional emails per campaign
export const generatedEmails = pgTable("generated_emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  marketId: varchar("market_id").references(() => markets.id, { onDelete: "set null" }),
  platform: text("platform").notNull().default("outlook"),
  tone: text("tone").notNull().default("professional"),
  callToAction: text("call_to_action"),
  recipientContext: text("recipient_context"),
  subject: text("subject").notNull(),
  previewText: text("preview_text"),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body"),
  subjectLineSuggestions: text("subject_line_suggestions").array(),
  coachingTips: text("coaching_tips").array(),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const generatedEmailsRelations = relations(generatedEmails, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [generatedEmails.campaignId],
    references: [campaigns.id],
  }),
  market: one(markets, {
    fields: [generatedEmails.marketId],
    references: [markets.id],
  }),
  createdByUser: one(users, {
    fields: [generatedEmails.createdBy],
    references: [users.id],
  }),
}));

export const insertGeneratedEmailSchema = createInsertSchema(generatedEmails).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type GeneratedEmail = typeof generatedEmails.$inferSelect;
export type InsertGeneratedEmail = z.infer<typeof insertGeneratedEmailSchema>;
export type InsertScheduledJobRun = z.infer<typeof insertScheduledJobRunSchema>;

export const DEFAULT_CONTENT_CATEGORIES = [
  "Blog Post", "White Paper", "Case Study", "eBook", "Infographic",
  "Webinar", "Video", "Podcast", "Press Release", "Newsletter",
  "Product Brief", "Datasheet", "Landing Page", "Social Media Post",
];

export const DEFAULT_BRAND_ASSET_CATEGORIES = [
  "Logo", "Icon", "Hero Image", "Banner", "Social Media Graphic",
  "Product Screenshot", "Headshot", "Illustration", "Template", "Brand Kit",
];

export const CONTENT_SEASON_OPTIONS = [
  "Spring", "Summer", "Fall", "Winter", "Q1", "Q2", "Q3", "Q4",
  "Holiday", "Back to School", "Year End",
];

export const CONTENT_TOPIC_OPTIONS = [
  "Modern Workplace", "Digital Transformation", "Cloud", "Security",
  "AI & Machine Learning", "Collaboration", "Productivity", "Remote Work",
  "Sustainability", "Innovation", "Leadership", "Customer Success",
];
