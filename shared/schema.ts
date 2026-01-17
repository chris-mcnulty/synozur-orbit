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
  tenantDomain: text("tenant_domain").notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  crawlData: jsonb("crawl_data"), // Crawled product page data
  analysisData: jsonb("analysis_data"), // AI analysis of product
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const projectProducts = pgTable("project_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => clientProjects.id, { onDelete: "cascade" }),
  productId: varchar("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("competitor"), // baseline, competitor, optional
  source: text("source").notNull().default("manual"), // manual, suggested
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const competitors = pgTable("competitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  linkedInUrl: text("linkedin_url"),
  instagramUrl: text("instagram_url"),
  faviconUrl: text("favicon_url"), // URL to stored favicon/logo
  screenshotUrl: text("screenshot_url"), // URL to stored homepage screenshot
  lastCrawl: text("last_crawl"),
  lastSocialCrawl: timestamp("last_social_crawl"),
  linkedInContent: text("linkedin_content"), // Last crawled LinkedIn page content for diff (messaging only)
  instagramContent: text("instagram_content"), // Last crawled Instagram page content for diff (messaging only)
  linkedInEngagement: jsonb("linkedin_engagement"), // Snapshot: {followers, posts, reactions, comments}
  instagramEngagement: jsonb("instagram_engagement"), // Snapshot: {followers, posts, likes, comments}
  blogSnapshot: jsonb("blog_snapshot"), // Snapshot: {postCount, latestTitles, capturedAt}
  crawlData: jsonb("crawl_data"), // Multi-page crawl results: {pages[], totalWordCount, crawledAt}
  lastFullCrawl: timestamp("last_full_crawl"), // Timestamp of last multi-page crawl
  previousWebsiteContent: text("previous_website_content"), // Previous crawl content for change detection
  lastWebsiteMonitor: timestamp("last_website_monitor"), // Timestamp of last website change monitoring
  status: text("status").notNull().default("Active"),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").references(() => clientProjects.id, { onDelete: "set null" }), // Optional: for client project work
  analysisData: jsonb("analysis_data"), // AI analysis results
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const activity = pgTable("activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  competitorId: varchar("competitor_id").notNull().references(() => competitors.id),
  competitorName: text("competitor_name").notNull(),
  description: text("description").notNull(),
  date: text("date").notNull(),
  impact: text("impact").notNull(),
  userId: varchar("user_id").references(() => users.id),
  tenantDomain: text("tenant_domain"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const recommendations = pgTable("recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  area: text("area").notNull(),
  impact: text("impact").notNull(),
  userId: varchar("user_id").references(() => users.id),
  tenantDomain: text("tenant_domain"),
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
  createdBy: varchar("created_by").references(() => users.id),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const analysis = pgTable("analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  tenantDomain: text("tenant_domain"),
  themes: jsonb("themes").notNull(),
  messaging: jsonb("messaging").notNull(),
  gaps: jsonb("gaps").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const battlecards = pgTable("battlecards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  competitorId: varchar("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  tenantDomain: text("tenant_domain").notNull(),
  strengths: jsonb("strengths"), // Array of competitor strengths
  weaknesses: jsonb("weaknesses"), // Array of competitor weaknesses
  ourAdvantages: jsonb("our_advantages"), // How we beat this competitor
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

export const insertTenantInviteSchema = createInsertSchema(tenantInvites).omit({
  id: true,
  createdAt: true,
  acceptedAt: true,
});

export const insertDomainBlocklistSchema = createInsertSchema(domainBlocklist).omit({
  id: true,
  createdAt: true,
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
  lastGeneratedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;
export type InsertEmailVerificationToken = z.infer<typeof insertEmailVerificationTokenSchema>;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type InsertTenantInvite = z.infer<typeof insertTenantInviteSchema>;
export type TenantInvite = typeof tenantInvites.$inferSelect;
export type InsertDomainBlocklist = z.infer<typeof insertDomainBlocklistSchema>;
export type DomainBlocklist = typeof domainBlocklist.$inferSelect;
export type InsertClientProject = z.infer<typeof insertClientProjectSchema>;
export type ClientProject = typeof clientProjects.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;
export type InsertProjectProduct = z.infer<typeof insertProjectProductSchema>;
export type ProjectProduct = typeof projectProducts.$inferSelect;
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
export const groundingDocuments = pgTable("grounding_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  fileType: text("file_type").notNull(), // pdf, docx, txt, md
  fileUrl: text("file_url").notNull(), // Object storage path
  fileSize: integer("file_size").notNull(), // Size in bytes
  extractedText: text("extracted_text"), // Extracted text content for AI context
  scope: text("scope").notNull().default("tenant"), // tenant-wide or competitor-specific
  competitorId: varchar("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  tenantDomain: text("tenant_domain").notNull(), // Email domain for tenant scoping
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
export const companyProfiles = pgTable("company_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  tenantDomain: text("tenant_domain").notNull().unique(),
  companyName: text("company_name").notNull(),
  websiteUrl: text("website_url").notNull(),
  linkedInUrl: text("linkedin_url"),
  instagramUrl: text("instagram_url"),
  description: text("description"),
  lastAnalysis: timestamp("last_analysis"),
  analysisData: jsonb("analysis_data"),
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
