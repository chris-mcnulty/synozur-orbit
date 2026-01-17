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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  domain: text("domain").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  userCount: integer("user_count").notNull().default(0),
  competitorLimit: integer("competitor_limit").notNull().default(3),
  analysisLimit: integer("analysis_limit").notNull().default(5),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: text("primary_color").default("#810FFB"),
  secondaryColor: text("secondary_color").default("#E60CB3"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const competitors = pgTable("competitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  lastCrawl: text("last_crawl"),
  status: text("status").notNull().default("Active"),
  userId: varchar("user_id").notNull().references(() => users.id),
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

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;
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

// Company profiles table for baselining own website
export const companyProfiles = pgTable("company_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  tenantDomain: text("tenant_domain").notNull().unique(),
  companyName: text("company_name").notNull(),
  websiteUrl: text("website_url").notNull(),
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
