import { 
  users, 
  tenants,
  domainBlocklist,
  clientProjects,
  competitors, 
  activity, 
  recommendations, 
  reports, 
  analysis,
  groundingDocuments,
  globalGroundingDocuments,
  companyProfiles,
  assessments,
  emailVerificationTokens,
  tenantInvites,
  products,
  projectProducts,
  battlecards,
  productBattlecards,
  longFormRecommendations,
  pageViews,
  markets,
  consultantAccess,
  aiUsage,
  marketingPlans,
  marketingTasks,
  type User, 
  type InsertUser,
  type Tenant,
  type InsertTenant,
  type DomainBlocklist,
  type InsertDomainBlocklist,
  type ClientProject,
  type InsertClientProject,
  type Competitor,
  type InsertCompetitor,
  type Activity,
  type InsertActivity,
  type Recommendation,
  type InsertRecommendation,
  type Report,
  type InsertReport,
  type Analysis,
  type InsertAnalysis,
  type GroundingDocument,
  type InsertGroundingDocument,
  type GlobalGroundingDocument,
  type InsertGlobalGroundingDocument,
  type CompanyProfile,
  type InsertCompanyProfile,
  type Assessment,
  type InsertAssessment,
  type EmailVerificationToken,
  type InsertEmailVerificationToken,
  passwordResetTokens,
  type PasswordResetToken,
  type InsertPasswordResetToken,
  type TenantInvite,
  type InsertTenantInvite,
  type Product,
  type InsertProduct,
  type ProjectProduct,
  type InsertProjectProduct,
  type Battlecard,
  type InsertBattlecard,
  type ProductBattlecard,
  type InsertProductBattlecard,
  type LongFormRecommendation,
  type InsertLongFormRecommendation,
  type PageView,
  type InsertPageView,
  type CompetitorScore,
  type InsertCompetitorScore,
  type SocialMetric,
  type InsertSocialMetric,
  type ExecutiveSummary,
  type InsertExecutiveSummary,
  type Market,
  type InsertMarket,
  type ConsultantAccess,
  type InsertConsultantAccess,
  type AiUsage,
  type InsertAiUsage,
  type MarketingPlan,
  type InsertMarketingPlan,
  type MarketingTask,
  type InsertMarketingTask,
  productFeatures,
  roadmapItems,
  featureRecommendations,
  type ProductFeature,
  type InsertProductFeature,
  type RoadmapItem,
  type InsertRoadmapItem,
  type FeatureRecommendation,
  type InsertFeatureRecommendation,
  competitorScores,
  socialMetrics,
  scoreHistory,
  executiveSummaries,
  scheduledJobRuns,
  type ScheduledJobRun,
  type InsertScheduledJobRun,
  type ScoreHistory,
  type InsertScoreHistory,
  servicePlans,
  type ServicePlan,
  type InsertServicePlan,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, sql, count, countDistinct, isNull, or } from "drizzle-orm";

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 100
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const is412 = error?.code === 412 || error?.message?.includes('412') || error?.message?.includes('Precondition Failed');
      const isConnectionError = error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT';
      
      if ((is412 || isConnectionError) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`[DB Retry] Attempt ${attempt}/${maxRetries} failed with ${error?.code || 'error'}, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export interface ContextFilter {
  tenantId: string;
  marketId: string;
  tenantDomain: string;
  isDefaultMarket?: boolean;
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByEntraId(entraId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getGlobalAdmin(): Promise<User | undefined>;
  getDomainAdmin(domain: string): Promise<User | undefined>;
  getUsersByDomain(domain: string): Promise<User[]>;
  
  // Tenant methods
  getTenant(id: string): Promise<Tenant | undefined>;
  getTenantByDomain(domain: string): Promise<Tenant | undefined>;
  getAllTenants(): Promise<Tenant[]>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: string, data: Partial<Tenant>): Promise<Tenant>;
  getTenantsWithUserCounts(): Promise<Array<Tenant & { actualUserCount: number }>>;
  
  // Competitor methods
  getCompetitor(id: string): Promise<Competitor | undefined>;
  getAllCompetitors(): Promise<Competitor[]>;
  getCompetitorsByUserId(userId: string): Promise<Competitor[]>;
  getCompetitorsByTenantDomain(tenantDomain: string): Promise<Competitor[]>;
  createCompetitor(competitor: InsertCompetitor): Promise<Competitor>;
  updateCompetitor(id: string, data: Partial<Competitor>): Promise<Competitor>;
  updateCompetitorLastCrawl(id: string, lastCrawl: string): Promise<void>;
  updateCompetitorAnalysis(id: string, analysisData: any): Promise<void>;
  deleteCompetitor(id: string): Promise<void>;
  
  // Activity methods
  getAllActivity(): Promise<Activity[]>;
  getActivityByTenant(tenantDomain: string): Promise<Activity[]>;
  getWeeklyActivityByTenant(tenantDomain: string, marketId?: string): Promise<Activity[]>;
  createActivity(activity: InsertActivity): Promise<Activity>;
  
  // Weekly Digest methods
  getUsersWithDigestEnabled(): Promise<User[]>;
  
  // Recommendation methods
  getAllRecommendations(): Promise<Recommendation[]>;
  getRecommendationsByTenant(tenantDomain: string): Promise<Recommendation[]>;
  createRecommendation(recommendation: InsertRecommendation): Promise<Recommendation>;
  getRecommendation(id: string): Promise<Recommendation | undefined>;
  updateRecommendation(id: string, data: Partial<Recommendation>): Promise<Recommendation>;
  
  // Report methods
  getAllReports(): Promise<Report[]>;
  getReportsByTenant(tenantDomain: string): Promise<Report[]>;
  getReport(id: string): Promise<Report | undefined>;
  createReport(report: InsertReport): Promise<Report>;
  
  // Analysis methods
  getLatestAnalysis(): Promise<Analysis | undefined>;
  getLatestAnalysisByTenant(tenantDomain: string): Promise<Analysis | undefined>;
  getLatestAnalysisByContext(ctx: ContextFilter): Promise<Analysis | undefined>;
  createAnalysis(analysis: InsertAnalysis): Promise<Analysis>;
  
  // Grounding Document methods
  getGroundingDocument(id: string): Promise<GroundingDocument | undefined>;
  getGroundingDocumentsByTenant(tenantDomain: string): Promise<GroundingDocument[]>;
  getGroundingDocumentsByCompetitor(competitorId: string): Promise<GroundingDocument[]>;
  createGroundingDocument(document: InsertGroundingDocument): Promise<GroundingDocument>;
  updateGroundingDocumentText(id: string, extractedText: string): Promise<void>;
  deleteGroundingDocument(id: string): Promise<void>;
  
  // Global Grounding Document methods (application-wide AI context)
  getAllGlobalGroundingDocuments(): Promise<GlobalGroundingDocument[]>;
  getActiveGlobalGroundingDocuments(): Promise<GlobalGroundingDocument[]>;
  getGlobalGroundingDocumentsByCategory(category: string): Promise<GlobalGroundingDocument[]>;
  getGlobalGroundingDocument(id: string): Promise<GlobalGroundingDocument | undefined>;
  createGlobalGroundingDocument(document: InsertGlobalGroundingDocument): Promise<GlobalGroundingDocument>;
  updateGlobalGroundingDocument(id: string, data: Partial<GlobalGroundingDocument>): Promise<GlobalGroundingDocument>;
  deleteGlobalGroundingDocument(id: string): Promise<void>;
  
  // Company Profile methods (baseline own website)
  getCompanyProfile(id: string): Promise<CompanyProfile | undefined>;
  getCompanyProfileByTenant(tenantDomain: string): Promise<CompanyProfile | undefined>;
  getCompanyProfilesByTenantDomain(tenantDomain: string): Promise<CompanyProfile[]>;
  createCompanyProfile(profile: InsertCompanyProfile): Promise<CompanyProfile>;
  updateCompanyProfile(id: string, data: Partial<CompanyProfile>): Promise<CompanyProfile>;
  deleteCompanyProfile(id: string): Promise<void>;
  
  // Assessment methods (snapshots for comparison)
  getAssessment(id: string): Promise<Assessment | undefined>;
  getAssessmentsByTenant(tenantDomain: string): Promise<Assessment[]>;
  getAssessmentsByContext(ctx: ContextFilter): Promise<Assessment[]>;
  getAssessmentsByUser(userId: string): Promise<Assessment[]>;
  createAssessment(assessment: InsertAssessment): Promise<Assessment>;
  updateAssessment(id: string, data: Partial<Assessment>): Promise<Assessment>;
  deleteAssessment(id: string): Promise<void>;
  
  // Email Verification Token methods
  createEmailVerificationToken(token: InsertEmailVerificationToken): Promise<EmailVerificationToken>;
  getEmailVerificationToken(token: string): Promise<EmailVerificationToken | undefined>;
  getMostRecentVerificationToken(email: string): Promise<EmailVerificationToken | undefined>;
  markEmailVerificationTokenUsed(token: string): Promise<void>;
  
  // Password Reset Token methods
  createPasswordResetToken(token: InsertPasswordResetToken): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenUsed(token: string): Promise<void>;
  
  // Tenant Invite methods
  createTenantInvite(invite: InsertTenantInvite): Promise<TenantInvite>;
  getTenantInvite(id: string): Promise<TenantInvite | undefined>;
  getTenantInviteByToken(token: string): Promise<TenantInvite | undefined>;
  getTenantInvitesByDomain(tenantDomain: string): Promise<TenantInvite[]>;
  updateTenantInvite(id: string, data: Partial<TenantInvite>): Promise<TenantInvite>;
  deleteTenantInvite(id: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
  deleteTenant(id: string): Promise<void>;
  
  // Domain Blocklist methods
  getDomainBlocklist(): Promise<DomainBlocklist[]>;
  isdomainBlocked(domain: string): Promise<boolean>;
  addBlockedDomain(entry: InsertDomainBlocklist): Promise<DomainBlocklist>;
  removeBlockedDomain(domain: string): Promise<void>;
  
  // Client Project methods (proxy analysis for consulting firms)
  getClientProject(id: string): Promise<ClientProject | undefined>;
  getClientProjectsByTenant(tenantDomain: string): Promise<ClientProject[]>;
  getClientProjectsByOwner(ownerUserId: string): Promise<ClientProject[]>;
  createClientProject(project: InsertClientProject): Promise<ClientProject>;
  updateClientProject(id: string, data: Partial<ClientProject>): Promise<ClientProject>;
  deleteClientProject(id: string): Promise<void>;
  getCompetitorsByProject(projectId: string): Promise<Competitor[]>;
  
  // Product methods (for product-vs-product analysis)
  getProduct(id: string): Promise<Product | undefined>;
  getProductsByTenant(tenantDomain: string): Promise<Product[]>;
  getProductsByCompetitor(competitorId: string): Promise<Product[]>;
  getProductsByCompanyProfile(companyProfileId: string): Promise<Product[]>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, data: Partial<Product>): Promise<Product>;
  deleteProduct(id: string): Promise<void>;
  
  // Project-Product methods
  getProjectProducts(projectId: string): Promise<Array<ProjectProduct & { product: Product }>>;
  addProductToProject(data: InsertProjectProduct): Promise<ProjectProduct>;
  removeProductFromProject(projectId: string, productId: string): Promise<void>;
  updateProjectProductRole(projectId: string, productId: string, role: string): Promise<void>;
  
  // Battlecard methods
  getBattlecard(id: string): Promise<Battlecard | undefined>;
  getBattlecardByCompetitor(competitorId: string): Promise<Battlecard | undefined>;
  getBattlecardsByTenant(tenantDomain: string): Promise<Battlecard[]>;
  createBattlecard(battlecard: InsertBattlecard): Promise<Battlecard>;
  updateBattlecard(id: string, data: Partial<Battlecard>): Promise<Battlecard>;
  deleteBattlecard(id: string): Promise<void>;
  
  // Product Battlecard methods
  getProductBattlecard(id: string): Promise<ProductBattlecard | undefined>;
  getProductBattlecardByProducts(baselineProductId: string, competitorProductId: string): Promise<ProductBattlecard | undefined>;
  getProductBattlecardsByProject(projectId: string): Promise<ProductBattlecard[]>;
  createProductBattlecard(battlecard: InsertProductBattlecard): Promise<ProductBattlecard>;
  updateProductBattlecard(id: string, data: Partial<ProductBattlecard>): Promise<ProductBattlecard>;
  deleteProductBattlecard(id: string): Promise<void>;
  
  // Long-form recommendation methods
  getLongFormRecommendation(id: string): Promise<LongFormRecommendation | undefined>;
  getLongFormRecommendationByType(type: string, projectId?: string, companyProfileId?: string): Promise<LongFormRecommendation | undefined>;
  getLongFormRecommendationsByProject(projectId: string): Promise<LongFormRecommendation[]>;
  getLongFormRecommendationsByCompanyProfile(companyProfileId: string): Promise<LongFormRecommendation[]>;
  createLongFormRecommendation(recommendation: InsertLongFormRecommendation): Promise<LongFormRecommendation>;
  updateLongFormRecommendation(id: string, data: Partial<LongFormRecommendation>): Promise<LongFormRecommendation>;
  deleteLongFormRecommendation(id: string): Promise<void>;
  
  // Competitor score methods (also supports product scores)
  getCompetitorScore(competitorId: string, projectId?: string): Promise<CompetitorScore | undefined>;
  getProductScore(productId: string, projectId?: string): Promise<CompetitorScore | undefined>;
  getCompetitorScoresByProject(projectId: string): Promise<CompetitorScore[]>;
  getCompetitorScoresByTenant(tenantDomain: string): Promise<CompetitorScore[]>;
  getCompetitorScoresByContext(ctx: ContextFilter): Promise<CompetitorScore[]>;
  upsertCompetitorScore(score: InsertCompetitorScore): Promise<CompetitorScore>;
  upsertProductScore(score: InsertCompetitorScore): Promise<CompetitorScore>;
  
  // Social metrics methods
  getSocialMetrics(competitorId: string, platform?: string): Promise<SocialMetric[]>;
  getSocialMetricsByTenant(tenantDomain: string): Promise<SocialMetric[]>;
  getSocialMetricsByContext(ctx: ContextFilter): Promise<SocialMetric[]>;
  createSocialMetric(metric: InsertSocialMetric): Promise<SocialMetric>;
  
  // Score history methods (for tracking scores over time)
  getScoreHistory(entityType: string, entityId: string, limit?: number): Promise<ScoreHistory[]>;
  getScoreHistoryByContext(ctx: ContextFilter, entityType?: string, limit?: number): Promise<ScoreHistory[]>;
  createScoreHistory(history: InsertScoreHistory): Promise<ScoreHistory>;
  getLatestScoreForEntity(entityType: string, entityId: string): Promise<ScoreHistory | undefined>;
  
  // Executive summary methods
  getExecutiveSummary(projectId?: string, companyProfileId?: string): Promise<ExecutiveSummary | undefined>;
  getExecutiveSummaryByContext(ctx: ContextFilter, projectId?: string, companyProfileId?: string): Promise<ExecutiveSummary | undefined>;
  upsertExecutiveSummary(summary: InsertExecutiveSummary): Promise<ExecutiveSummary>;
  
  // Market methods (multi-market support for enterprise tenants)
  getMarket(id: string): Promise<Market | undefined>;
  getMarketsByTenant(tenantId: string): Promise<Market[]>;
  getDefaultMarket(tenantId: string): Promise<Market | undefined>;
  createMarket(market: InsertMarket): Promise<Market>;
  updateMarket(id: string, data: Partial<Market>): Promise<Market>;
  deleteMarket(id: string): Promise<void>;
  validateMarketBelongsToTenant(marketId: string, tenantId: string): Promise<boolean>;
  
  // Consultant access methods (cross-tenant access management)
  getConsultantAccess(id: string): Promise<ConsultantAccess | undefined>;
  getConsultantAccessByUser(userId: string): Promise<ConsultantAccess[]>;
  getConsultantAccessByTenant(tenantId: string): Promise<ConsultantAccess[]>;
  getActiveConsultantAccess(userId: string, tenantId: string): Promise<ConsultantAccess | undefined>;
  createConsultantAccess(access: InsertConsultantAccess): Promise<ConsultantAccess>;
  revokeConsultantAccess(id: string): Promise<void>;
  getAccessibleTenants(userId: string, userRole: string, userTenantDomain: string): Promise<Tenant[]>;
  
  // Context-aware methods (filter by tenant and market)
  getCompetitorsByContext(ctx: ContextFilter): Promise<Competitor[]>;
  getCompetitorByIdWithContext(id: string, ctx: ContextFilter): Promise<Competitor | undefined>;
  getCompanyProfileByContext(ctx: ContextFilter): Promise<CompanyProfile | undefined>;
  getClientProjectsByContext(ctx: ContextFilter): Promise<ClientProject[]>;
  getClientProjectByIdWithContext(id: string, ctx: ContextFilter): Promise<ClientProject | undefined>;
  getProductsByContext(ctx: ContextFilter): Promise<Product[]>;
  getAssessmentsByContext(ctx: ContextFilter): Promise<Assessment[]>;
  getAssessmentByIdWithContext(id: string, ctx: ContextFilter): Promise<Assessment | undefined>;
  getReportsByContext(ctx: ContextFilter): Promise<(Report & { marketName?: string })[]>;
  getReportByIdWithContext(id: string, ctx: ContextFilter): Promise<Report | undefined>;
  getRecommendationsByContext(ctx: ContextFilter): Promise<Recommendation[]>;
  getActivityByContext(ctx: ContextFilter): Promise<Activity[]>;
  getGroundingDocumentsByContext(ctx: ContextFilter): Promise<GroundingDocument[]>;
  getBattlecardsByContext(ctx: ContextFilter): Promise<Battlecard[]>;
  
  // AI usage tracking methods
  logAiUsage(usage: InsertAiUsage): Promise<AiUsage>;
  getAiUsageStats(): Promise<{
    totalRequests: number;
    totalEstimatedCost: number;
    requestsByOperation: Record<string, number>;
    dailyUsage: Record<string, number>;
    recentLogs: AiUsage[];
  }>;
  
  // Product Feature methods
  getProductFeature(id: string): Promise<ProductFeature | undefined>;
  getProductFeaturesByProduct(productId: string): Promise<ProductFeature[]>;
  getProductFeaturesByContext(ctx: ContextFilter): Promise<ProductFeature[]>;
  createProductFeature(feature: InsertProductFeature): Promise<ProductFeature>;
  updateProductFeature(id: string, data: Partial<ProductFeature>): Promise<ProductFeature>;
  deleteProductFeature(id: string): Promise<void>;
  
  // Roadmap Item methods
  getRoadmapItem(id: string): Promise<RoadmapItem | undefined>;
  getRoadmapItemsByProduct(productId: string): Promise<RoadmapItem[]>;
  getRoadmapItemsByContext(ctx: ContextFilter): Promise<RoadmapItem[]>;
  createRoadmapItem(item: InsertRoadmapItem): Promise<RoadmapItem>;
  updateRoadmapItem(id: string, data: Partial<RoadmapItem>): Promise<RoadmapItem>;
  deleteRoadmapItem(id: string): Promise<void>;
  
  // Feature Recommendation methods
  getFeatureRecommendation(id: string): Promise<FeatureRecommendation | undefined>;
  getFeatureRecommendationsByProduct(productId: string): Promise<FeatureRecommendation[]>;
  getFeatureRecommendationsByContext(ctx: ContextFilter): Promise<FeatureRecommendation[]>;
  createFeatureRecommendation(recommendation: InsertFeatureRecommendation): Promise<FeatureRecommendation>;
  updateFeatureRecommendation(id: string, data: Partial<FeatureRecommendation>): Promise<FeatureRecommendation>;
  deleteFeatureRecommendation(id: string): Promise<void>;
  addRecommendationToRoadmap(recId: string, roadmapData: InsertRoadmapItem): Promise<{ roadmapItem: RoadmapItem; recommendation: FeatureRecommendation }>;
  
  // Service Plan methods
  getServicePlan(id: string): Promise<ServicePlan | undefined>;
  getServicePlanByName(name: string): Promise<ServicePlan | undefined>;
  getAllServicePlans(): Promise<ServicePlan[]>;
  getActiveServicePlans(): Promise<ServicePlan[]>;
  getDefaultServicePlan(): Promise<ServicePlan | undefined>;
  createServicePlan(plan: InsertServicePlan): Promise<ServicePlan>;
  updateServicePlan(id: string, data: Partial<ServicePlan>): Promise<ServicePlan>;
  deleteServicePlan(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByEntraId(entraId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.entraId, entraId));
    return user || undefined;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getGlobalAdmin(): Promise<User | undefined> {
    const [admin] = await db.select().from(users).where(eq(users.role, "Global Admin"));
    return admin || undefined;
  }

  async getDomainAdmin(domain: string): Promise<User | undefined> {
    const allUsers = await db.select().from(users);
    const domainAdmin = allUsers.find(
      u => u.role === "Domain Admin" && u.email.endsWith(`@${domain}`)
    );
    return domainAdmin || undefined;
  }

  async getUsersByDomain(domain: string): Promise<User[]> {
    const allUsers = await db.select().from(users);
    return allUsers.filter(u => u.email.endsWith(`@${domain}`));
  }

  // Tenant methods
  async getTenant(id: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant || undefined;
  }

  async getTenantByDomain(domain: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.domain, domain));
    return tenant || undefined;
  }

  async getAllTenants(): Promise<Tenant[]> {
    return await db.select().from(tenants).orderBy(desc(tenants.createdAt));
  }

  async createTenant(insertTenant: InsertTenant): Promise<Tenant> {
    const [tenant] = await db
      .insert(tenants)
      .values(insertTenant)
      .returning();
    return tenant;
  }

  async updateTenant(id: string, data: Partial<Tenant>): Promise<Tenant> {
    const [tenant] = await db
      .update(tenants)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    return tenant;
  }

  async getTenantsWithUserCounts(): Promise<Array<Tenant & { actualUserCount: number }>> {
    const allTenants = await this.getAllTenants();
    const allUsers = await this.getAllUsers();
    
    return allTenants.map(tenant => {
      const userCount = allUsers.filter(u => u.email.endsWith(`@${tenant.domain}`)).length;
      return { ...tenant, actualUserCount: userCount };
    });
  }

  // Competitor methods
  async getCompetitor(id: string): Promise<Competitor | undefined> {
    const [competitor] = await db.select().from(competitors).where(eq(competitors.id, id));
    return competitor || undefined;
  }

  async getAllCompetitors(): Promise<Competitor[]> {
    return await db.select().from(competitors).orderBy(desc(competitors.createdAt));
  }

  async getCompetitorsByUserId(userId: string): Promise<Competitor[]> {
    return await db.select().from(competitors)
      .where(eq(competitors.userId, userId))
      .orderBy(desc(competitors.createdAt));
  }

  async getCompetitorsByTenantDomain(tenantDomain: string): Promise<Competitor[]> {
    const domainUsers = await this.getUsersByDomain(tenantDomain);
    const userIds = domainUsers.map(u => u.id);
    if (userIds.length === 0) return [];
    
    const allCompetitors = await this.getAllCompetitors();
    return allCompetitors.filter(c => userIds.includes(c.userId));
  }

  async createCompetitor(insertCompetitor: InsertCompetitor): Promise<Competitor> {
    const [competitor] = await db
      .insert(competitors)
      .values(insertCompetitor)
      .returning();
    return competitor;
  }

  async updateCompetitor(id: string, data: Partial<Competitor>): Promise<Competitor> {
    return await withRetry(async () => {
      const [competitor] = await db
        .update(competitors)
        .set(data)
        .where(eq(competitors.id, id))
        .returning();
      return competitor;
    });
  }

  async updateCompetitorLastCrawl(id: string, lastCrawl: string): Promise<void> {
    await withRetry(async () => {
      await db
        .update(competitors)
        .set({ lastCrawl })
        .where(eq(competitors.id, id));
    });
  }

  async updateCompetitorAnalysis(id: string, analysisData: any): Promise<void> {
    await withRetry(async () => {
      await db
        .update(competitors)
        .set({ analysisData })
        .where(eq(competitors.id, id));
    });
  }

  async deleteCompetitor(id: string): Promise<void> {
    await db.delete(competitors).where(eq(competitors.id, id));
  }

  // Activity methods
  async getAllActivity(): Promise<Activity[]> {
    return await db.select().from(activity).orderBy(desc(activity.createdAt));
  }

  async getActivityByTenant(tenantDomain: string): Promise<Activity[]> {
    return await db.select().from(activity)
      .where(eq(activity.tenantDomain, tenantDomain))
      .orderBy(desc(activity.createdAt));
  }

  async getWeeklyActivityByTenant(tenantDomain: string, marketId?: string): Promise<Activity[]> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const conditions = [
      eq(activity.tenantDomain, tenantDomain),
      gte(activity.createdAt, oneWeekAgo)
    ];
    
    if (marketId) {
      conditions.push(eq(activity.marketId, marketId));
    }
    
    return await db.select().from(activity)
      .where(and(...conditions))
      .orderBy(desc(activity.createdAt));
  }

  async getUsersWithDigestEnabled(): Promise<User[]> {
    return await db.select().from(users)
      .where(and(
        eq(users.weeklyDigestEnabled, true),
        eq(users.emailVerified, true),
        eq(users.status, "active")
      ));
  }

  async createActivity(insertActivity: InsertActivity): Promise<Activity> {
    const [newActivity] = await db
      .insert(activity)
      .values(insertActivity)
      .returning();
    return newActivity;
  }

  // Recommendation methods
  async getAllRecommendations(): Promise<Recommendation[]> {
    return await db.select().from(recommendations).orderBy(desc(recommendations.createdAt));
  }

  async getRecommendationsByTenant(tenantDomain: string): Promise<Recommendation[]> {
    return await db.select().from(recommendations)
      .where(eq(recommendations.tenantDomain, tenantDomain))
      .orderBy(desc(recommendations.createdAt));
  }

  async createRecommendation(insertRecommendation: InsertRecommendation): Promise<Recommendation> {
    const [recommendation] = await db
      .insert(recommendations)
      .values(insertRecommendation)
      .returning();
    return recommendation;
  }

  async getRecommendation(id: string): Promise<Recommendation | undefined> {
    const [recommendation] = await db.select().from(recommendations).where(eq(recommendations.id, id));
    return recommendation || undefined;
  }

  async updateRecommendation(id: string, data: Partial<Recommendation>): Promise<Recommendation> {
    const [updated] = await db
      .update(recommendations)
      .set(data)
      .where(eq(recommendations.id, id))
      .returning();
    return updated;
  }

  // Report methods
  async getAllReports(): Promise<Report[]> {
    return await db.select().from(reports).orderBy(desc(reports.createdAt));
  }

  async getReportsByTenant(tenantDomain: string): Promise<Report[]> {
    return await db.select().from(reports)
      .where(eq(reports.tenantDomain, tenantDomain))
      .orderBy(desc(reports.createdAt));
  }

  async getReport(id: string): Promise<Report | undefined> {
    const [report] = await db.select().from(reports).where(eq(reports.id, id));
    return report || undefined;
  }

  async createReport(insertReport: InsertReport): Promise<Report> {
    const [report] = await db
      .insert(reports)
      .values(insertReport)
      .returning();
    return report;
  }

  // Analysis methods
  async getLatestAnalysis(): Promise<Analysis | undefined> {
    const [latestAnalysis] = await db.select().from(analysis).orderBy(desc(analysis.createdAt)).limit(1);
    return latestAnalysis || undefined;
  }

  async getLatestAnalysisByTenant(tenantDomain: string): Promise<Analysis | undefined> {
    const [latestAnalysis] = await db.select().from(analysis)
      .where(eq(analysis.tenantDomain, tenantDomain))
      .orderBy(desc(analysis.createdAt))
      .limit(1);
    return latestAnalysis || undefined;
  }

  async getLatestAnalysisByContext(ctx: ContextFilter): Promise<Analysis | undefined> {
    const conditions = [eq(analysis.tenantDomain, ctx.tenantDomain)];
    if (ctx.marketId) {
      const marketCondition = ctx.isDefaultMarket
        ? or(eq(analysis.marketId, ctx.marketId), isNull(analysis.marketId))
        : eq(analysis.marketId, ctx.marketId);
      conditions.push(marketCondition!);
    }
    const [latestAnalysis] = await db.select().from(analysis)
      .where(and(...conditions))
      .orderBy(desc(analysis.createdAt))
      .limit(1);
    return latestAnalysis || undefined;
  }

  async createAnalysis(insertAnalysis: InsertAnalysis): Promise<Analysis> {
    const [newAnalysis] = await db
      .insert(analysis)
      .values(insertAnalysis)
      .returning();
    return newAnalysis;
  }

  // Grounding Document methods
  async getGroundingDocument(id: string): Promise<GroundingDocument | undefined> {
    const [doc] = await db.select().from(groundingDocuments).where(eq(groundingDocuments.id, id));
    return doc || undefined;
  }

  async getGroundingDocumentsByTenant(tenantDomain: string): Promise<GroundingDocument[]> {
    return await db.select().from(groundingDocuments)
      .where(eq(groundingDocuments.tenantDomain, tenantDomain))
      .orderBy(desc(groundingDocuments.createdAt));
  }

  async getGroundingDocumentsByCompetitor(competitorId: string): Promise<GroundingDocument[]> {
    return await db.select().from(groundingDocuments)
      .where(eq(groundingDocuments.competitorId, competitorId))
      .orderBy(desc(groundingDocuments.createdAt));
  }

  async createGroundingDocument(insertDoc: InsertGroundingDocument): Promise<GroundingDocument> {
    const [doc] = await db
      .insert(groundingDocuments)
      .values(insertDoc)
      .returning();
    return doc;
  }

  async updateGroundingDocumentText(id: string, extractedText: string): Promise<void> {
    await db
      .update(groundingDocuments)
      .set({ extractedText, updatedAt: new Date() })
      .where(eq(groundingDocuments.id, id));
  }

  async deleteGroundingDocument(id: string): Promise<void> {
    await db.delete(groundingDocuments).where(eq(groundingDocuments.id, id));
  }

  // Global Grounding Document methods (application-wide AI context)
  async getAllGlobalGroundingDocuments(): Promise<GlobalGroundingDocument[]> {
    return await db.select().from(globalGroundingDocuments)
      .orderBy(desc(globalGroundingDocuments.createdAt));
  }

  async getActiveGlobalGroundingDocuments(): Promise<GlobalGroundingDocument[]> {
    return await db.select().from(globalGroundingDocuments)
      .where(eq(globalGroundingDocuments.isActive, true))
      .orderBy(desc(globalGroundingDocuments.createdAt));
  }

  async getGlobalGroundingDocumentsByCategory(category: string): Promise<GlobalGroundingDocument[]> {
    return await db.select().from(globalGroundingDocuments)
      .where(and(
        eq(globalGroundingDocuments.category, category),
        eq(globalGroundingDocuments.isActive, true)
      ))
      .orderBy(desc(globalGroundingDocuments.createdAt));
  }

  async getGlobalGroundingDocument(id: string): Promise<GlobalGroundingDocument | undefined> {
    const [doc] = await db.select().from(globalGroundingDocuments)
      .where(eq(globalGroundingDocuments.id, id));
    return doc || undefined;
  }

  async createGlobalGroundingDocument(insertDoc: InsertGlobalGroundingDocument): Promise<GlobalGroundingDocument> {
    const [doc] = await db
      .insert(globalGroundingDocuments)
      .values(insertDoc)
      .returning();
    return doc;
  }

  async updateGlobalGroundingDocument(id: string, data: Partial<GlobalGroundingDocument>): Promise<GlobalGroundingDocument> {
    const [doc] = await db
      .update(globalGroundingDocuments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(globalGroundingDocuments.id, id))
      .returning();
    return doc;
  }

  async deleteGlobalGroundingDocument(id: string): Promise<void> {
    await db.delete(globalGroundingDocuments).where(eq(globalGroundingDocuments.id, id));
  }

  // Company Profile methods (baseline own website)
  async getCompanyProfile(id: string): Promise<CompanyProfile | undefined> {
    const [profile] = await db.select().from(companyProfiles).where(eq(companyProfiles.id, id));
    return profile || undefined;
  }

  async getCompanyProfileByTenant(tenantDomain: string): Promise<CompanyProfile | undefined> {
    const [profile] = await db.select().from(companyProfiles).where(eq(companyProfiles.tenantDomain, tenantDomain));
    return profile || undefined;
  }

  async getCompanyProfilesByTenantDomain(tenantDomain: string): Promise<CompanyProfile[]> {
    return await db.select().from(companyProfiles)
      .where(eq(companyProfiles.tenantDomain, tenantDomain));
  }

  async createCompanyProfile(insertProfile: InsertCompanyProfile): Promise<CompanyProfile> {
    const [profile] = await db
      .insert(companyProfiles)
      .values(insertProfile)
      .returning();
    return profile;
  }

  async updateCompanyProfile(id: string, data: Partial<CompanyProfile>): Promise<CompanyProfile> {
    return await withRetry(async () => {
      const [profile] = await db
        .update(companyProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(companyProfiles.id, id))
        .returning();
      return profile;
    });
  }

  async deleteCompanyProfile(id: string): Promise<void> {
    await db.delete(companyProfiles).where(eq(companyProfiles.id, id));
  }

  // Assessment methods (snapshots for comparison)
  async getAssessment(id: string): Promise<Assessment | undefined> {
    const [assessment] = await db.select().from(assessments).where(eq(assessments.id, id));
    return assessment || undefined;
  }

  async getAssessmentsByTenant(tenantDomain: string): Promise<Assessment[]> {
    return await db.select().from(assessments)
      .where(eq(assessments.tenantDomain, tenantDomain))
      .orderBy(desc(assessments.createdAt));
  }

  async getAssessmentsByUser(userId: string): Promise<Assessment[]> {
    return await db.select().from(assessments)
      .where(eq(assessments.userId, userId))
      .orderBy(desc(assessments.createdAt));
  }

  async createAssessment(insertAssessment: InsertAssessment): Promise<Assessment> {
    const [assessment] = await db
      .insert(assessments)
      .values(insertAssessment)
      .returning();
    return assessment;
  }

  async updateAssessment(id: string, data: Partial<Assessment>): Promise<Assessment> {
    const [assessment] = await db
      .update(assessments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(assessments.id, id))
      .returning();
    return assessment;
  }

  async deleteAssessment(id: string): Promise<void> {
    await db.delete(assessments).where(eq(assessments.id, id));
  }

  // Email Verification Token methods
  async createEmailVerificationToken(insertToken: InsertEmailVerificationToken): Promise<EmailVerificationToken> {
    const [token] = await db
      .insert(emailVerificationTokens)
      .values(insertToken)
      .returning();
    return token;
  }

  async getEmailVerificationToken(token: string): Promise<EmailVerificationToken | undefined> {
    const [result] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.token, token));
    return result || undefined;
  }

  async getMostRecentVerificationToken(email: string): Promise<EmailVerificationToken | undefined> {
    const [result] = await db.select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.email, email))
      .orderBy(desc(emailVerificationTokens.expiresAt))
      .limit(1);
    return result || undefined;
  }

  async markEmailVerificationTokenUsed(token: string): Promise<void> {
    await db.update(emailVerificationTokens)
      .set({ used: true })
      .where(eq(emailVerificationTokens.token, token));
  }

  async createPasswordResetToken(insertToken: InsertPasswordResetToken): Promise<PasswordResetToken> {
    const [token] = await db
      .insert(passwordResetTokens)
      .values(insertToken)
      .returning();
    return token;
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const [result] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token));
    return result || undefined;
  }

  async markPasswordResetTokenUsed(token: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.token, token));
  }

  // Tenant Invite methods
  async createTenantInvite(insertInvite: InsertTenantInvite): Promise<TenantInvite> {
    const [invite] = await db
      .insert(tenantInvites)
      .values(insertInvite)
      .returning();
    return invite;
  }

  async getTenantInvite(id: string): Promise<TenantInvite | undefined> {
    const [invite] = await db.select().from(tenantInvites).where(eq(tenantInvites.id, id));
    return invite || undefined;
  }

  async getTenantInviteByToken(token: string): Promise<TenantInvite | undefined> {
    const [invite] = await db.select().from(tenantInvites).where(eq(tenantInvites.token, token));
    return invite || undefined;
  }

  async getTenantInvitesByDomain(tenantDomain: string): Promise<TenantInvite[]> {
    return await db.select().from(tenantInvites)
      .where(eq(tenantInvites.tenantDomain, tenantDomain))
      .orderBy(desc(tenantInvites.createdAt));
  }

  async updateTenantInvite(id: string, data: Partial<TenantInvite>): Promise<TenantInvite> {
    const [invite] = await db
      .update(tenantInvites)
      .set(data)
      .where(eq(tenantInvites.id, id))
      .returning();
    return invite;
  }

  async deleteTenantInvite(id: string): Promise<void> {
    await db.delete(tenantInvites).where(eq(tenantInvites.id, id));
  }

  async deleteUser(id: string): Promise<void> {
    // Nullify references in tables with nullable user foreign keys
    await db.update(recommendations).set({ userId: null, assignedTo: null }).where(or(eq(recommendations.userId, id), eq(recommendations.assignedTo, id)));
    await db.update(analysis).set({ userId: null }).where(eq(analysis.userId, id));
    await db.update(domainBlocklist).set({ createdBy: null }).where(eq(domainBlocklist.createdBy, id));
    await db.update(longFormRecommendations).set({ generatedBy: null }).where(eq(longFormRecommendations.generatedBy, id));
    await db.update(reports).set({ createdBy: null }).where(eq(reports.createdBy, id));
    
    // Get all competitors owned by this user so we can delete their related activity records
    const userCompetitors = await db.select({ id: competitors.id }).from(competitors)
      .where(eq(competitors.userId, id));
    
    // Delete activity records that reference these competitors (foreign key constraint)
    for (const comp of userCompetitors) {
      await db.delete(activity).where(eq(activity.competitorId, comp.id));
    }
    
    // Delete records with NOT NULL user foreign keys (must delete, cannot nullify)
    await db.delete(activity).where(eq(activity.userId, id));
    await db.delete(groundingDocuments).where(eq(groundingDocuments.userId, id));
    await db.delete(globalGroundingDocuments).where(eq(globalGroundingDocuments.uploadedBy, id));
    await db.delete(tenantInvites).where(eq(tenantInvites.invitedBy, id));
    await db.delete(assessments).where(eq(assessments.userId, id));
    await db.delete(battlecards).where(eq(battlecards.createdBy, id));
    await db.delete(productBattlecards).where(eq(productBattlecards.createdBy, id));
    await db.delete(products).where(eq(products.createdBy, id));
    await db.delete(companyProfiles).where(eq(companyProfiles.userId, id));
    await db.delete(competitors).where(eq(competitors.userId, id));
    await db.delete(markets).where(eq(markets.createdBy, id));
    await db.delete(clientProjects).where(eq(clientProjects.ownerUserId, id));
    await db.delete(consultantAccess).where(eq(consultantAccess.grantedBy, id));
    
    // Now delete the user (consultantAccess.userId will cascade automatically)
    await db.delete(users).where(eq(users.id, id));
  }

  async deleteTenant(id: string): Promise<void> {
    // Get tenant domain for cleaning up related records
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) return;
    
    const tenantDomain = tenant.domain;
    
    // Delete all records that reference this tenant by domain
    // Order matters due to foreign key constraints
    
    // Delete records with tenantDomain references
    await db.delete(recommendations).where(eq(recommendations.tenantDomain, tenantDomain));
    await db.delete(longFormRecommendations).where(eq(longFormRecommendations.tenantDomain, tenantDomain));
    await db.delete(activity).where(eq(activity.tenantDomain, tenantDomain));
    await db.delete(analysis).where(eq(analysis.tenantDomain, tenantDomain));
    await db.delete(reports).where(eq(reports.tenantDomain, tenantDomain));
    await db.delete(groundingDocuments).where(eq(groundingDocuments.tenantDomain, tenantDomain));
    await db.delete(assessments).where(eq(assessments.tenantDomain, tenantDomain));
    await db.delete(companyProfiles).where(eq(companyProfiles.tenantDomain, tenantDomain));
    await db.delete(competitorScores).where(eq(competitorScores.tenantDomain, tenantDomain));
    await db.delete(socialMetrics).where(eq(socialMetrics.tenantDomain, tenantDomain));
    await db.delete(executiveSummaries).where(eq(executiveSummaries.tenantDomain, tenantDomain));
    await db.delete(battlecards).where(eq(battlecards.tenantDomain, tenantDomain));
    await db.delete(productBattlecards).where(eq(productBattlecards.tenantDomain, tenantDomain));
    await db.delete(products).where(eq(products.tenantDomain, tenantDomain));
    await db.delete(clientProjects).where(eq(clientProjects.tenantDomain, tenantDomain));
    await db.delete(tenantInvites).where(eq(tenantInvites.tenantDomain, tenantDomain));
    
    // Delete records with tenantId references (markets, consultantAccess)
    await db.delete(markets).where(eq(markets.tenantId, id));
    await db.delete(consultantAccess).where(eq(consultantAccess.tenantId, id));
    
    // Delete users that belong to this tenant (by email domain matching tenant domain)
    const allUsers = await db.select().from(users);
    const tenantUsers = allUsers.filter(u => u.email.split("@")[1]?.toLowerCase() === tenantDomain.toLowerCase());
    for (const user of tenantUsers) {
      await this.deleteUser(user.id);
    }
    
    // Finally delete the tenant itself
    await db.delete(tenants).where(eq(tenants.id, id));
  }

  // Domain Blocklist methods
  async getDomainBlocklist(): Promise<DomainBlocklist[]> {
    return await db.select().from(domainBlocklist).orderBy(desc(domainBlocklist.createdAt));
  }

  async isdomainBlocked(domain: string): Promise<boolean> {
    const [entry] = await db.select().from(domainBlocklist).where(eq(domainBlocklist.domain, domain.toLowerCase()));
    return !!entry;
  }

  async addBlockedDomain(entry: InsertDomainBlocklist): Promise<DomainBlocklist> {
    const [result] = await db
      .insert(domainBlocklist)
      .values({ ...entry, domain: entry.domain.toLowerCase() })
      .returning();
    return result;
  }

  async removeBlockedDomain(domain: string): Promise<void> {
    await db.delete(domainBlocklist).where(eq(domainBlocklist.domain, domain.toLowerCase()));
  }

  // Client Project methods
  async getClientProject(id: string): Promise<ClientProject | undefined> {
    const [project] = await db.select().from(clientProjects).where(eq(clientProjects.id, id));
    return project || undefined;
  }

  async getClientProjectsByTenant(tenantDomain: string): Promise<ClientProject[]> {
    return await db.select().from(clientProjects)
      .where(eq(clientProjects.tenantDomain, tenantDomain))
      .orderBy(desc(clientProjects.createdAt));
  }

  async getClientProjectsByOwner(ownerUserId: string): Promise<ClientProject[]> {
    return await db.select().from(clientProjects)
      .where(eq(clientProjects.ownerUserId, ownerUserId))
      .orderBy(desc(clientProjects.createdAt));
  }

  async createClientProject(project: InsertClientProject): Promise<ClientProject> {
    const [result] = await db
      .insert(clientProjects)
      .values(project)
      .returning();
    return result;
  }

  async updateClientProject(id: string, data: Partial<ClientProject>): Promise<ClientProject> {
    const [result] = await db
      .update(clientProjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clientProjects.id, id))
      .returning();
    return result;
  }

  async deleteClientProject(id: string): Promise<void> {
    await db.delete(clientProjects).where(eq(clientProjects.id, id));
  }

  async getCompetitorsByProject(projectId: string): Promise<Competitor[]> {
    return await db.select().from(competitors)
      .where(eq(competitors.projectId, projectId))
      .orderBy(desc(competitors.createdAt));
  }

  // Product methods
  async getProduct(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product || undefined;
  }

  async getProductsByTenant(tenantDomain: string): Promise<Product[]> {
    return await db.select().from(products)
      .where(eq(products.tenantDomain, tenantDomain))
      .orderBy(desc(products.createdAt));
  }

  async getProductsByCompetitor(competitorId: string): Promise<Product[]> {
    return await db.select().from(products)
      .where(eq(products.competitorId, competitorId))
      .orderBy(desc(products.createdAt));
  }

  async getProductsByCompanyProfile(companyProfileId: string): Promise<Product[]> {
    return await db.select().from(products)
      .where(eq(products.companyProfileId, companyProfileId))
      .orderBy(desc(products.createdAt));
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [result] = await db
      .insert(products)
      .values(product)
      .returning();
    return result;
  }

  async updateProduct(id: string, data: Partial<Product>): Promise<Product> {
    const [result] = await db
      .update(products)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    return result;
  }

  async deleteProduct(id: string): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  // Project-Product methods
  async getProjectProducts(projectId: string): Promise<Array<ProjectProduct & { product: Product }>> {
    const results = await db.select()
      .from(projectProducts)
      .innerJoin(products, eq(projectProducts.productId, products.id))
      .where(eq(projectProducts.projectId, projectId));
    
    return results.map(r => ({
      ...r.project_products,
      product: r.products
    }));
  }

  async addProductToProject(data: InsertProjectProduct): Promise<ProjectProduct> {
    const [result] = await db
      .insert(projectProducts)
      .values(data)
      .returning();
    return result;
  }

  async removeProductFromProject(projectId: string, productId: string): Promise<void> {
    await db.delete(projectProducts)
      .where(and(
        eq(projectProducts.projectId, projectId),
        eq(projectProducts.productId, productId)
      ));
  }

  async updateProjectProductRole(projectId: string, productId: string, role: string): Promise<void> {
    await db.update(projectProducts)
      .set({ role })
      .where(and(
        eq(projectProducts.projectId, projectId),
        eq(projectProducts.productId, productId)
      ));
  }

  // Battlecard methods
  async getBattlecard(id: string): Promise<Battlecard | undefined> {
    const [battlecard] = await db.select().from(battlecards).where(eq(battlecards.id, id));
    return battlecard || undefined;
  }

  async getBattlecardByCompetitor(competitorId: string): Promise<Battlecard | undefined> {
    const [battlecard] = await db.select().from(battlecards)
      .where(eq(battlecards.competitorId, competitorId));
    return battlecard || undefined;
  }

  async getBattlecardsByTenant(tenantDomain: string): Promise<Battlecard[]> {
    return await db.select().from(battlecards)
      .where(eq(battlecards.tenantDomain, tenantDomain))
      .orderBy(desc(battlecards.createdAt));
  }

  async createBattlecard(battlecard: InsertBattlecard): Promise<Battlecard> {
    const [result] = await db
      .insert(battlecards)
      .values(battlecard)
      .returning();
    return result;
  }

  async updateBattlecard(id: string, data: Partial<Battlecard>): Promise<Battlecard> {
    const [result] = await db
      .update(battlecards)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(battlecards.id, id))
      .returning();
    return result;
  }

  async deleteBattlecard(id: string): Promise<void> {
    await db.delete(battlecards).where(eq(battlecards.id, id));
  }

  // Product Battlecard methods
  async getProductBattlecard(id: string): Promise<ProductBattlecard | undefined> {
    const [battlecard] = await db.select().from(productBattlecards).where(eq(productBattlecards.id, id));
    return battlecard || undefined;
  }

  async getProductBattlecardByProducts(baselineProductId: string, competitorProductId: string): Promise<ProductBattlecard | undefined> {
    const [battlecard] = await db.select().from(productBattlecards)
      .where(and(
        eq(productBattlecards.baselineProductId, baselineProductId),
        eq(productBattlecards.competitorProductId, competitorProductId)
      ));
    return battlecard || undefined;
  }

  async getProductBattlecardsByProject(projectId: string): Promise<ProductBattlecard[]> {
    return await db.select().from(productBattlecards)
      .where(eq(productBattlecards.projectId, projectId))
      .orderBy(desc(productBattlecards.createdAt));
  }

  async createProductBattlecard(battlecard: InsertProductBattlecard): Promise<ProductBattlecard> {
    const [result] = await db
      .insert(productBattlecards)
      .values(battlecard)
      .returning();
    return result;
  }

  async updateProductBattlecard(id: string, data: Partial<ProductBattlecard>): Promise<ProductBattlecard> {
    const [result] = await db
      .update(productBattlecards)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(productBattlecards.id, id))
      .returning();
    return result;
  }

  async deleteProductBattlecard(id: string): Promise<void> {
    await db.delete(productBattlecards).where(eq(productBattlecards.id, id));
  }
  
  // Long-form recommendation methods
  async getLongFormRecommendation(id: string): Promise<LongFormRecommendation | undefined> {
    const [recommendation] = await db.select().from(longFormRecommendations).where(eq(longFormRecommendations.id, id));
    return recommendation || undefined;
  }

  async getLongFormRecommendationByType(type: string, projectId?: string, companyProfileId?: string): Promise<LongFormRecommendation | undefined> {
    if (projectId) {
      const [recommendation] = await db.select().from(longFormRecommendations)
        .where(and(
          eq(longFormRecommendations.type, type),
          eq(longFormRecommendations.projectId, projectId)
        ));
      return recommendation || undefined;
    }
    if (companyProfileId) {
      const [recommendation] = await db.select().from(longFormRecommendations)
        .where(and(
          eq(longFormRecommendations.type, type),
          eq(longFormRecommendations.companyProfileId, companyProfileId)
        ));
      return recommendation || undefined;
    }
    return undefined;
  }

  async getLongFormRecommendationsByProject(projectId: string): Promise<LongFormRecommendation[]> {
    return await db.select().from(longFormRecommendations)
      .where(eq(longFormRecommendations.projectId, projectId))
      .orderBy(desc(longFormRecommendations.createdAt));
  }

  async getLongFormRecommendationsByCompanyProfile(companyProfileId: string): Promise<LongFormRecommendation[]> {
    return await db.select().from(longFormRecommendations)
      .where(eq(longFormRecommendations.companyProfileId, companyProfileId))
      .orderBy(desc(longFormRecommendations.createdAt));
  }

  async createLongFormRecommendation(recommendation: InsertLongFormRecommendation): Promise<LongFormRecommendation> {
    const [result] = await db
      .insert(longFormRecommendations)
      .values(recommendation)
      .returning();
    return result;
  }

  async updateLongFormRecommendation(id: string, data: Partial<LongFormRecommendation>): Promise<LongFormRecommendation> {
    const [result] = await db
      .update(longFormRecommendations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(longFormRecommendations.id, id))
      .returning();
    return result;
  }

  async deleteLongFormRecommendation(id: string): Promise<void> {
    await db.delete(longFormRecommendations).where(eq(longFormRecommendations.id, id));
  }

  // Page view analytics methods
  async createPageView(pageView: InsertPageView): Promise<PageView> {
    const [result] = await db
      .insert(pageViews)
      .values(pageView)
      .returning();
    return result;
  }

  async getPageViewStats(days: number): Promise<{
    totalViews: number;
    uniqueVisitors: number;
    signupPageViews: number;
    dailyViews: Array<{ date: string; views: number; uniqueVisitors: number; signupViews: number }>;
    referrers: Array<{ referrer: string; count: number }>;
    utmCampaigns: Array<{ campaign: string; source: string; medium: string; count: number }>;
    browsers: Array<{ browser: string; count: number }>;
    countries: Array<{ country: string; count: number }>;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const allViews = await db.select().from(pageViews).where(gte(pageViews.createdAt, startDate));
    
    const totalViews = allViews.length;
    const uniqueSessionIds = new Set(allViews.map(v => v.sessionId));
    const uniqueVisitors = uniqueSessionIds.size;
    const signupPageViews = allViews.filter(v => v.path === "/auth/signup").length;

    // Parse browser from user agent
    const parseBrowser = (ua: string | null): string => {
      if (!ua) return "Unknown";
      if (ua.includes("Edg/")) return "Edge";
      if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "Chrome";
      if (ua.includes("Firefox/")) return "Firefox";
      if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
      if (ua.includes("MSIE") || ua.includes("Trident/")) return "Internet Explorer";
      if (ua.includes("Opera") || ua.includes("OPR/")) return "Opera";
      return "Other";
    };

    const browserMap = new Map<string, number>();
    allViews.forEach(view => {
      const browser = parseBrowser(view.userAgent);
      browserMap.set(browser, (browserMap.get(browser) || 0) + 1);
    });
    const browsers = Array.from(browserMap.entries())
      .map(([browser, count]) => ({ browser, count }))
      .sort((a, b) => b.count - a.count);

    const countryMap = new Map<string, number>();
    allViews.forEach(view => {
      const country = view.country || "Unknown";
      countryMap.set(country, (countryMap.get(country) || 0) + 1);
    });
    const countries = Array.from(countryMap.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const dailyMap = new Map<string, { views: number; sessions: Set<string>; signupViews: number }>();
    
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dailyMap.set(dateStr, { views: 0, sessions: new Set(), signupViews: 0 });
    }

    allViews.forEach(view => {
      const dateStr = view.createdAt.toISOString().split('T')[0];
      if (dailyMap.has(dateStr)) {
        const day = dailyMap.get(dateStr)!;
        day.views++;
        day.sessions.add(view.sessionId);
        if (view.path === "/auth/signup") day.signupViews++;
      }
    });

    const dailyViews = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        views: data.views,
        uniqueVisitors: data.sessions.size,
        signupViews: data.signupViews,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const referrerMap = new Map<string, number>();
    allViews.forEach(view => {
      const ref = view.referrer || "Direct";
      referrerMap.set(ref, (referrerMap.get(ref) || 0) + 1);
    });
    const referrers = Array.from(referrerMap.entries())
      .map(([referrer, count]) => ({ referrer, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const utmMap = new Map<string, { source: string; medium: string; count: number }>();
    allViews.forEach(view => {
      if (view.utmCampaign || view.utmSource) {
        const key = `${view.utmCampaign || "none"}_${view.utmSource || "none"}_${view.utmMedium || "none"}`;
        const existing = utmMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          utmMap.set(key, {
            source: view.utmSource || "",
            medium: view.utmMedium || "",
            count: 1,
          });
        }
      }
    });
    const utmCampaigns = Array.from(utmMap.entries())
      .map(([key, data]) => ({
        campaign: key.split("_")[0] === "none" ? "" : key.split("_")[0],
        source: data.source,
        medium: data.medium,
        count: data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalViews,
      uniqueVisitors,
      signupPageViews,
      dailyViews,
      referrers,
      utmCampaigns,
      browsers,
      countries,
    };
  }

  // Competitor score methods
  async getCompetitorScore(competitorId: string, projectId?: string): Promise<CompetitorScore | undefined> {
    if (projectId) {
      const [score] = await db.select().from(competitorScores)
        .where(and(
          eq(competitorScores.competitorId, competitorId),
          eq(competitorScores.projectId, projectId)
        ));
      return score || undefined;
    }
    const [score] = await db.select().from(competitorScores)
      .where(eq(competitorScores.competitorId, competitorId));
    return score || undefined;
  }

  async getCompetitorScoresByProject(projectId: string): Promise<CompetitorScore[]> {
    return await db.select().from(competitorScores)
      .where(eq(competitorScores.projectId, projectId))
      .orderBy(desc(competitorScores.overallScore));
  }

  async getCompetitorScoresByTenant(tenantDomain: string): Promise<CompetitorScore[]> {
    return await db.select().from(competitorScores)
      .where(eq(competitorScores.tenantDomain, tenantDomain))
      .orderBy(desc(competitorScores.overallScore));
  }

  async getCompetitorScoresByContext(ctx: ContextFilter): Promise<CompetitorScore[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(competitorScores.marketId, ctx.marketId), isNull(competitorScores.marketId))
      : eq(competitorScores.marketId, ctx.marketId);
    
    return await db.select().from(competitorScores)
      .where(
        and(
          eq(competitorScores.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(competitorScores.overallScore));
  }

  async upsertCompetitorScore(score: InsertCompetitorScore): Promise<CompetitorScore> {
    const existing = score.competitorId 
      ? await this.getCompetitorScore(score.competitorId, score.projectId ?? undefined)
      : undefined;
    if (existing) {
      const [result] = await db
        .update(competitorScores)
        .set({ ...score, updatedAt: new Date(), lastCalculatedAt: new Date() })
        .where(eq(competitorScores.id, existing.id))
        .returning();
      return result;
    }
    const [result] = await db
      .insert(competitorScores)
      .values(score)
      .returning();
    return result;
  }

  async getProductScore(productId: string, projectId?: string): Promise<CompetitorScore | undefined> {
    if (projectId) {
      const [score] = await db.select().from(competitorScores)
        .where(and(
          eq(competitorScores.productId, productId),
          eq(competitorScores.projectId, projectId)
        ));
      return score || undefined;
    }
    const [score] = await db.select().from(competitorScores)
      .where(eq(competitorScores.productId, productId));
    return score || undefined;
  }

  async upsertProductScore(score: InsertCompetitorScore): Promise<CompetitorScore> {
    if (!score.productId) {
      throw new Error('productId is required for product scores');
    }
    const existing = await this.getProductScore(score.productId, score.projectId ?? undefined);
    if (existing) {
      const [result] = await db
        .update(competitorScores)
        .set({ ...score, updatedAt: new Date(), lastCalculatedAt: new Date() })
        .where(eq(competitorScores.id, existing.id))
        .returning();
      return result;
    }
    const [result] = await db
      .insert(competitorScores)
      .values(score)
      .returning();
    return result;
  }

  // Social metrics methods
  async getSocialMetrics(competitorId: string, platform?: string): Promise<SocialMetric[]> {
    if (platform) {
      return await db.select().from(socialMetrics)
        .where(and(
          eq(socialMetrics.competitorId, competitorId),
          eq(socialMetrics.platform, platform)
        ))
        .orderBy(desc(socialMetrics.capturedAt));
    }
    return await db.select().from(socialMetrics)
      .where(eq(socialMetrics.competitorId, competitorId))
      .orderBy(desc(socialMetrics.capturedAt));
  }

  async getSocialMetricsByTenant(tenantDomain: string): Promise<SocialMetric[]> {
    return await db.select().from(socialMetrics)
      .where(eq(socialMetrics.tenantDomain, tenantDomain))
      .orderBy(desc(socialMetrics.capturedAt));
  }

  async getSocialMetricsByContext(ctx: ContextFilter): Promise<SocialMetric[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(socialMetrics.marketId, ctx.marketId), isNull(socialMetrics.marketId))
      : eq(socialMetrics.marketId, ctx.marketId);
    
    return await db.select().from(socialMetrics)
      .where(
        and(
          eq(socialMetrics.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(socialMetrics.capturedAt));
  }

  async createSocialMetric(metric: InsertSocialMetric): Promise<SocialMetric> {
    const [result] = await db
      .insert(socialMetrics)
      .values(metric)
      .returning();
    return result;
  }

  // Score history methods
  async getScoreHistory(entityType: string, entityId: string, limit: number = 12): Promise<ScoreHistory[]> {
    return db.select().from(scoreHistory)
      .where(and(
        eq(scoreHistory.entityType, entityType),
        eq(scoreHistory.entityId, entityId)
      ))
      .orderBy(desc(scoreHistory.recordedAt))
      .limit(limit);
  }

  async getScoreHistoryByContext(ctx: ContextFilter, entityType?: string, limit: number = 50): Promise<ScoreHistory[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(scoreHistory.marketId, ctx.marketId), isNull(scoreHistory.marketId))
      : eq(scoreHistory.marketId, ctx.marketId);
    
    const conditions = [
      eq(scoreHistory.tenantDomain, ctx.tenantDomain),
      marketCondition
    ];
    
    if (entityType) {
      conditions.push(eq(scoreHistory.entityType, entityType));
    }
    
    return db.select().from(scoreHistory)
      .where(and(...conditions))
      .orderBy(desc(scoreHistory.recordedAt))
      .limit(limit);
  }

  async createScoreHistory(history: InsertScoreHistory): Promise<ScoreHistory> {
    const [result] = await db
      .insert(scoreHistory)
      .values(history)
      .returning();
    return result;
  }

  async getLatestScoreForEntity(entityType: string, entityId: string): Promise<ScoreHistory | undefined> {
    const [result] = await db.select().from(scoreHistory)
      .where(and(
        eq(scoreHistory.entityType, entityType),
        eq(scoreHistory.entityId, entityId)
      ))
      .orderBy(desc(scoreHistory.recordedAt))
      .limit(1);
    return result || undefined;
  }

  // Executive summary methods
  async getExecutiveSummary(projectId?: string, companyProfileId?: string): Promise<ExecutiveSummary | undefined> {
    if (projectId) {
      const [summary] = await db.select().from(executiveSummaries)
        .where(eq(executiveSummaries.projectId, projectId));
      return summary || undefined;
    }
    if (companyProfileId) {
      const [summary] = await db.select().from(executiveSummaries)
        .where(eq(executiveSummaries.companyProfileId, companyProfileId));
      return summary || undefined;
    }
    return undefined;
  }

  async getExecutiveSummaryByContext(ctx: ContextFilter, projectId?: string, companyProfileId?: string): Promise<ExecutiveSummary | undefined> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(executiveSummaries.marketId, ctx.marketId), isNull(executiveSummaries.marketId))
      : eq(executiveSummaries.marketId, ctx.marketId);
    
    const conditions = [
      eq(executiveSummaries.tenantDomain, ctx.tenantDomain),
      marketCondition
    ];
    
    if (projectId) {
      conditions.push(eq(executiveSummaries.projectId, projectId));
    }
    if (companyProfileId) {
      conditions.push(eq(executiveSummaries.companyProfileId, companyProfileId));
    }
    
    const [summary] = await db.select().from(executiveSummaries)
      .where(and(...conditions));
    return summary || undefined;
  }

  async upsertExecutiveSummary(summary: InsertExecutiveSummary): Promise<ExecutiveSummary> {
    const existing = await this.getExecutiveSummary(summary.projectId ?? undefined, summary.companyProfileId ?? undefined);
    if (existing) {
      const [result] = await db
        .update(executiveSummaries)
        .set({ ...summary, updatedAt: new Date(), lastGeneratedAt: new Date() })
        .where(eq(executiveSummaries.id, existing.id))
        .returning();
      return result;
    }
    const [result] = await db
      .insert(executiveSummaries)
      .values(summary)
      .returning();
    return result;
  }

  // Market methods
  async getMarket(id: string): Promise<Market | undefined> {
    const [market] = await db.select().from(markets).where(eq(markets.id, id));
    return market || undefined;
  }

  async getMarketsByTenant(tenantId: string): Promise<Market[]> {
    return await db.select().from(markets)
      .where(eq(markets.tenantId, tenantId))
      .orderBy(desc(markets.isDefault), markets.name);
  }

  async getDefaultMarket(tenantId: string): Promise<Market | undefined> {
    const [market] = await db.select().from(markets)
      .where(and(eq(markets.tenantId, tenantId), eq(markets.isDefault, true)));
    return market || undefined;
  }

  async createMarket(market: InsertMarket): Promise<Market> {
    const [result] = await db.insert(markets).values(market).returning();
    return result;
  }

  async updateMarket(id: string, data: Partial<Market>): Promise<Market> {
    const [result] = await db.update(markets)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(markets.id, id))
      .returning();
    return result;
  }

  async deleteMarket(id: string): Promise<void> {
    // Delete all related data for this market (cascade delete)
    // The schema uses onDelete: "set null" which would leave orphaned data, so we clean up explicitly
    
    // First, get all competitor IDs for this market so we can delete related activity records
    const marketCompetitors = await db.select({ id: competitors.id }).from(competitors)
      .where(eq(competitors.marketId, id));
    const competitorIds = marketCompetitors.map(c => c.id);
    
    // Delete activity records that reference these competitors (foreign key constraint)
    if (competitorIds.length > 0) {
      for (const competitorId of competitorIds) {
        await db.delete(activity).where(eq(activity.competitorId, competitorId));
      }
    }
    
    // Delete activity records that reference this market directly
    await db.delete(activity).where(eq(activity.marketId, id));
    
    // Now delete competitors and other market-related data
    await db.delete(competitors).where(eq(competitors.marketId, id));
    await db.delete(companyProfiles).where(eq(companyProfiles.marketId, id));
    await db.delete(clientProjects).where(eq(clientProjects.marketId, id));
    await db.delete(battlecards).where(eq(battlecards.marketId, id));
    await db.delete(executiveSummaries).where(eq(executiveSummaries.marketId, id));
    await db.delete(groundingDocuments).where(eq(groundingDocuments.marketId, id));
    await db.delete(competitorScores).where(eq(competitorScores.marketId, id));
    await db.delete(socialMetrics).where(eq(socialMetrics.marketId, id));
    // Finally delete the market itself
    await db.delete(markets).where(eq(markets.id, id));
  }

  async validateMarketBelongsToTenant(marketId: string, tenantId: string): Promise<boolean> {
    const [result] = await db.select({ id: markets.id }).from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.tenantId, tenantId)));
    return !!result;
  }

  // Consultant access methods
  async getConsultantAccess(id: string): Promise<ConsultantAccess | undefined> {
    const [access] = await db.select().from(consultantAccess)
      .where(eq(consultantAccess.id, id));
    return access || undefined;
  }

  async getConsultantAccessByUser(userId: string): Promise<ConsultantAccess[]> {
    return await db.select().from(consultantAccess)
      .where(and(eq(consultantAccess.userId, userId), eq(consultantAccess.status, "active")))
      .orderBy(desc(consultantAccess.grantedAt));
  }

  async getConsultantAccessByTenant(tenantId: string): Promise<ConsultantAccess[]> {
    return await db.select().from(consultantAccess)
      .where(eq(consultantAccess.tenantId, tenantId))
      .orderBy(desc(consultantAccess.grantedAt));
  }

  async getActiveConsultantAccess(userId: string, tenantId: string): Promise<ConsultantAccess | undefined> {
    const [access] = await db.select().from(consultantAccess)
      .where(and(
        eq(consultantAccess.userId, userId),
        eq(consultantAccess.tenantId, tenantId),
        eq(consultantAccess.status, "active")
      ));
    return access || undefined;
  }

  async createConsultantAccess(access: InsertConsultantAccess): Promise<ConsultantAccess> {
    const [result] = await db.insert(consultantAccess).values(access).returning();
    return result;
  }

  async revokeConsultantAccess(id: string): Promise<void> {
    await db.update(consultantAccess)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(consultantAccess.id, id));
  }

  async getAccessibleTenants(userId: string, userRole: string, userTenantDomain: string): Promise<Tenant[]> {
    if (userRole === "Global Admin") {
      return await this.getAllTenants();
    }
    
    if (userRole === "Consultant") {
      const grants = await this.getConsultantAccessByUser(userId);
      const grantedTenantIds = grants.map(g => g.tenantId);
      const userTenant = await this.getTenantByDomain(userTenantDomain);
      
      const accessibleTenants: Tenant[] = [];
      if (userTenant) {
        accessibleTenants.push(userTenant);
      }
      
      for (const tenantId of grantedTenantIds) {
        const tenant = await this.getTenant(tenantId);
        if (tenant && !accessibleTenants.find(t => t.id === tenant.id)) {
          accessibleTenants.push(tenant);
        }
      }
      return accessibleTenants;
    }
    
    const userTenant = await this.getTenantByDomain(userTenantDomain);
    return userTenant ? [userTenant] : [];
  }

  // Context-aware methods - filter by tenant domain AND market ID
  async getCompetitorsByContext(ctx: ContextFilter): Promise<Competitor[]> {
    const domainUsers = await this.getUsersByDomain(ctx.tenantDomain);
    const userIds = domainUsers.map(u => u.id);
    if (userIds.length === 0) return [];
    
    // First get competitors specifically for this market
    const marketCompetitors = await db.select().from(competitors)
      .where(
        and(
          eq(competitors.marketId, ctx.marketId),
          isNull(competitors.projectId)
        )
      )
      .orderBy(desc(competitors.createdAt));
    
    let result = marketCompetitors.filter(c => userIds.includes(c.userId));
    
    // For default market only, also include legacy competitors with NULL marketId
    const defaultMarket = await db.select().from(markets)
      .where(and(
        eq(markets.tenantId, ctx.tenantId),
        eq(markets.isDefault, true)
      ));
    
    if (defaultMarket.length > 0 && defaultMarket[0].id === ctx.marketId) {
      const legacyCompetitors = await db.select().from(competitors)
        .where(
          and(
            isNull(competitors.marketId),
            isNull(competitors.projectId)
          )
        )
        .orderBy(desc(competitors.createdAt));
      
      const legacyFiltered = legacyCompetitors.filter(c => userIds.includes(c.userId));
      result = [...result, ...legacyFiltered];
    }
    
    return result;
  }

  async getCompetitorByIdWithContext(id: string, ctx: ContextFilter): Promise<Competitor | undefined> {
    const [competitor] = await db.select().from(competitors).where(eq(competitors.id, id));
    if (!competitor) return undefined;
    
    const user = await this.getUser(competitor.userId);
    if (!user) return undefined;
    
    const userDomain = user.email.split("@")[1];
    if (userDomain !== ctx.tenantDomain) return undefined;
    
    if (competitor.marketId && competitor.marketId !== ctx.marketId) return undefined;
    
    return competitor;
  }

  async getCompanyProfileByContext(ctx: ContextFilter): Promise<CompanyProfile | undefined> {
    // First try to find a profile specifically for this market
    const [marketProfile] = await db.select().from(companyProfiles)
      .where(
        and(
          eq(companyProfiles.tenantDomain, ctx.tenantDomain),
          eq(companyProfiles.marketId, ctx.marketId)
        )
      );
    if (marketProfile) return marketProfile;
    
    // For default market only, also check for legacy profiles with NULL marketId
    if (ctx.isDefaultMarket) {
      const [legacyProfile] = await db.select().from(companyProfiles)
        .where(
          and(
            eq(companyProfiles.tenantDomain, ctx.tenantDomain),
            isNull(companyProfiles.marketId)
          )
        );
      return legacyProfile || undefined;
    }
    
    return undefined;
  }

  async getClientProjectsByContext(ctx: ContextFilter): Promise<ClientProject[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(clientProjects.marketId, ctx.marketId), isNull(clientProjects.marketId))
      : eq(clientProjects.marketId, ctx.marketId);
    
    return await db.select().from(clientProjects)
      .where(
        and(
          eq(clientProjects.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(clientProjects.createdAt));
  }

  async getClientProjectByIdWithContext(id: string, ctx: ContextFilter): Promise<ClientProject | undefined> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(clientProjects.marketId, ctx.marketId), isNull(clientProjects.marketId))
      : eq(clientProjects.marketId, ctx.marketId);
    
    const [project] = await db.select().from(clientProjects)
      .where(
        and(
          eq(clientProjects.id, id),
          eq(clientProjects.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      );
    return project || undefined;
  }

  async getProductsByContext(ctx: ContextFilter): Promise<Product[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(products.marketId, ctx.marketId), isNull(products.marketId))
      : eq(products.marketId, ctx.marketId);
    
    return await db.select().from(products)
      .where(
        and(
          eq(products.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(products.createdAt));
  }

  async getAssessmentsByContext(ctx: ContextFilter): Promise<Assessment[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(assessments.marketId, ctx.marketId), isNull(assessments.marketId))
      : eq(assessments.marketId, ctx.marketId);
    
    return await db.select().from(assessments)
      .where(
        and(
          eq(assessments.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(assessments.createdAt));
  }

  async getAssessmentByIdWithContext(id: string, ctx: ContextFilter): Promise<Assessment | undefined> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(assessments.marketId, ctx.marketId), isNull(assessments.marketId))
      : eq(assessments.marketId, ctx.marketId);
    
    const [assessment] = await db.select().from(assessments)
      .where(
        and(
          eq(assessments.id, id),
          eq(assessments.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      );
    return assessment || undefined;
  }

  async getReportsByContext(ctx: ContextFilter): Promise<(Report & { marketName?: string })[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(reports.marketId, ctx.marketId), isNull(reports.marketId))
      : eq(reports.marketId, ctx.marketId);
    
    const result = await db.select({
      report: reports,
      marketName: markets.name,
    }).from(reports)
      .leftJoin(markets, eq(reports.marketId, markets.id))
      .where(
        and(
          eq(reports.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(reports.createdAt));
    
    return result.map(r => ({
      ...r.report,
      marketName: r.marketName || undefined,
    }));
  }

  async getReportByIdWithContext(id: string, ctx: ContextFilter): Promise<Report | undefined> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(reports.marketId, ctx.marketId), isNull(reports.marketId))
      : eq(reports.marketId, ctx.marketId);
    
    const [report] = await db.select().from(reports)
      .where(
        and(
          eq(reports.id, id),
          eq(reports.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      );
    return report || undefined;
  }

  async getRecommendationsByContext(ctx: ContextFilter): Promise<Recommendation[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(recommendations.marketId, ctx.marketId), isNull(recommendations.marketId))
      : eq(recommendations.marketId, ctx.marketId);
    
    return await db.select().from(recommendations)
      .where(
        and(
          eq(recommendations.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(recommendations.createdAt));
  }

  async getActivityByContext(ctx: ContextFilter): Promise<Activity[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(activity.marketId, ctx.marketId), isNull(activity.marketId))
      : eq(activity.marketId, ctx.marketId);
    
    return await db.select().from(activity)
      .where(
        and(
          eq(activity.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(activity.createdAt));
  }

  async getGroundingDocumentsByContext(ctx: ContextFilter): Promise<GroundingDocument[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(groundingDocuments.marketId, ctx.marketId), isNull(groundingDocuments.marketId))
      : eq(groundingDocuments.marketId, ctx.marketId);
    
    return await db.select().from(groundingDocuments)
      .where(
        and(
          eq(groundingDocuments.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(groundingDocuments.createdAt));
  }

  async getBattlecardsByContext(ctx: ContextFilter): Promise<Battlecard[]> {
    const marketCondition = ctx.isDefaultMarket
      ? or(eq(battlecards.marketId, ctx.marketId), isNull(battlecards.marketId))
      : eq(battlecards.marketId, ctx.marketId);
    
    return await db.select().from(battlecards)
      .where(
        and(
          eq(battlecards.tenantDomain, ctx.tenantDomain),
          marketCondition
        )
      )
      .orderBy(desc(battlecards.createdAt));
  }

  async logAiUsage(usage: InsertAiUsage): Promise<AiUsage> {
    const [logged] = await db.insert(aiUsage).values(usage).returning();
    return logged;
  }

  async getAiUsageStats(): Promise<{
    totalRequests: number;
    totalEstimatedCost: number;
    requestsByOperation: Record<string, number>;
    dailyUsage: Record<string, number>;
    recentLogs: AiUsage[];
  }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const allLogs = await db.select().from(aiUsage)
      .where(gte(aiUsage.createdAt, thirtyDaysAgo))
      .orderBy(desc(aiUsage.createdAt));
    
    const totalRequests = allLogs.length;
    
    let totalEstimatedCost = 0;
    allLogs.forEach(log => {
      if (log.estimatedCost) {
        totalEstimatedCost += parseFloat(log.estimatedCost);
      } else if (log.inputTokens || log.outputTokens) {
        const inputCost = ((log.inputTokens || 0) / 1_000_000) * 3.0;
        const outputCost = ((log.outputTokens || 0) / 1_000_000) * 15.0;
        totalEstimatedCost += inputCost + outputCost;
      }
    });
    
    const requestsByOperation: Record<string, number> = {};
    allLogs.forEach(log => {
      requestsByOperation[log.operation] = (requestsByOperation[log.operation] || 0) + 1;
    });
    
    const dailyUsage: Record<string, number> = {};
    allLogs.forEach(log => {
      const dateKey = log.createdAt.toISOString().split('T')[0];
      dailyUsage[dateKey] = (dailyUsage[dateKey] || 0) + 1;
    });
    
    const recentLogs = allLogs.slice(0, 20);
    
    return {
      totalRequests,
      totalEstimatedCost,
      requestsByOperation,
      dailyUsage,
      recentLogs,
    };
  }

  // Marketing Plans methods
  async getMarketingPlans(ctx: { tenantDomain: string; marketId: string | null }): Promise<MarketingPlan[]> {
    const marketCondition = ctx.marketId 
      ? eq(marketingPlans.marketId, ctx.marketId)
      : isNull(marketingPlans.marketId);
    
    return db.select().from(marketingPlans)
      .where(and(
        eq(marketingPlans.tenantDomain, ctx.tenantDomain),
        marketCondition
      ))
      .orderBy(desc(marketingPlans.createdAt));
  }

  async getMarketingPlan(id: string, ctx: { tenantDomain: string; marketId: string | null }): Promise<MarketingPlan | null> {
    // When fetching by specific ID, allow access if plan belongs to tenant
    // This enables direct navigation to plan detail pages
    const [plan] = await db.select().from(marketingPlans)
      .where(and(
        eq(marketingPlans.id, id),
        eq(marketingPlans.tenantDomain, ctx.tenantDomain)
      ));
    return plan || null;
  }

  async createMarketingPlan(plan: InsertMarketingPlan): Promise<MarketingPlan> {
    const [created] = await db.insert(marketingPlans).values(plan).returning();
    return created;
  }

  async updateMarketingPlan(id: string, updates: Partial<InsertMarketingPlan>, ctx: { tenantDomain: string; marketId: string | null }): Promise<MarketingPlan | null> {
    const marketCondition = ctx.marketId 
      ? eq(marketingPlans.marketId, ctx.marketId)
      : isNull(marketingPlans.marketId);
    
    const [updated] = await db.update(marketingPlans)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(marketingPlans.id, id),
        eq(marketingPlans.tenantDomain, ctx.tenantDomain),
        marketCondition
      ))
      .returning();
    return updated || null;
  }

  async deleteMarketingPlan(id: string, ctx: { tenantDomain: string; marketId: string | null }): Promise<boolean> {
    const marketCondition = ctx.marketId 
      ? eq(marketingPlans.marketId, ctx.marketId)
      : isNull(marketingPlans.marketId);
    
    const result = await db.delete(marketingPlans)
      .where(and(
        eq(marketingPlans.id, id),
        eq(marketingPlans.tenantDomain, ctx.tenantDomain),
        marketCondition
      ))
      .returning();
    return result.length > 0;
  }

  // Marketing Tasks methods
  // Note: All task methods require a validated plan from getMarketingPlan() which enforces context filtering.
  // Tasks are only accessible after the plan's tenant/market context is verified at the API layer.
  async getMarketingTasks(planId: string, ctx: { tenantDomain: string; marketId: string | null }): Promise<MarketingTask[]> {
    // Verify plan belongs to context first (defense-in-depth)
    const plan = await this.getMarketingPlan(planId, ctx);
    if (!plan) return [];
    
    return db.select().from(marketingTasks)
      .where(eq(marketingTasks.planId, planId))
      .orderBy(marketingTasks.timeframe, marketingTasks.priority);
  }

  async createMarketingTask(task: InsertMarketingTask, ctx: { tenantDomain: string; marketId: string | null }): Promise<MarketingTask | null> {
    // Verify plan belongs to context first
    const plan = await this.getMarketingPlan(task.planId, ctx);
    if (!plan) return null;
    
    const [created] = await db.insert(marketingTasks).values(task).returning();
    return created;
  }

  async createMarketingTasks(tasks: InsertMarketingTask[], ctx: { tenantDomain: string; marketId: string | null }): Promise<MarketingTask[]> {
    if (tasks.length === 0) return [];
    
    // Verify plan belongs to context (all tasks should belong to same plan)
    const planId = tasks[0].planId;
    const plan = await this.getMarketingPlan(planId, ctx);
    if (!plan) return [];
    
    const created = await db.insert(marketingTasks).values(tasks).returning();
    return created;
  }

  async updateMarketingTask(id: string, planId: string, updates: Partial<InsertMarketingTask>, ctx: { tenantDomain: string; marketId: string | null }): Promise<MarketingTask | null> {
    // Verify plan belongs to context first
    const plan = await this.getMarketingPlan(planId, ctx);
    if (!plan) return null;
    
    const [updated] = await db.update(marketingTasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(
        eq(marketingTasks.id, id),
        eq(marketingTasks.planId, planId)
      ))
      .returning();
    return updated || null;
  }

  async deleteMarketingTask(id: string, planId: string, ctx: { tenantDomain: string; marketId: string | null }): Promise<boolean> {
    // Verify plan belongs to context first
    const plan = await this.getMarketingPlan(planId, ctx);
    if (!plan) return false;
    
    const result = await db.delete(marketingTasks)
      .where(and(
        eq(marketingTasks.id, id),
        eq(marketingTasks.planId, planId)
      ))
      .returning();
    return result.length > 0;
  }

  async deleteAllMarketingTasks(planId: string, ctx: { tenantDomain: string; marketId: string | null }): Promise<number> {
    // Verify plan belongs to context first
    const plan = await this.getMarketingPlan(planId, ctx);
    if (!plan) return 0;
    
    const result = await db.delete(marketingTasks)
      .where(eq(marketingTasks.planId, planId))
      .returning();
    return result.length;
  }

  // Product Feature methods
  async getProductFeature(id: string): Promise<ProductFeature | undefined> {
    const [feature] = await db.select().from(productFeatures).where(eq(productFeatures.id, id));
    return feature || undefined;
  }

  async getProductFeaturesByProduct(productId: string): Promise<ProductFeature[]> {
    return db.select().from(productFeatures)
      .where(eq(productFeatures.productId, productId))
      .orderBy(productFeatures.priority, productFeatures.name);
  }

  async getProductFeaturesByContext(ctx: ContextFilter): Promise<ProductFeature[]> {
    const marketCondition = ctx.marketId 
      ? eq(productFeatures.marketId, ctx.marketId)
      : isNull(productFeatures.marketId);
    
    return db.select().from(productFeatures)
      .where(and(
        eq(productFeatures.tenantDomain, ctx.tenantDomain),
        marketCondition
      ))
      .orderBy(productFeatures.name);
  }

  async createProductFeature(feature: InsertProductFeature): Promise<ProductFeature> {
    const [created] = await db.insert(productFeatures).values(feature).returning();
    return created;
  }

  async updateProductFeature(id: string, data: Partial<ProductFeature>): Promise<ProductFeature> {
    const [updated] = await db.update(productFeatures)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(productFeatures.id, id))
      .returning();
    return updated;
  }

  async deleteProductFeature(id: string): Promise<void> {
    await db.delete(productFeatures).where(eq(productFeatures.id, id));
  }

  // Roadmap Item methods
  async getRoadmapItem(id: string): Promise<RoadmapItem | undefined> {
    const [item] = await db.select().from(roadmapItems).where(eq(roadmapItems.id, id));
    return item || undefined;
  }

  async getRoadmapItemsByProduct(productId: string): Promise<RoadmapItem[]> {
    return db.select().from(roadmapItems)
      .where(eq(roadmapItems.productId, productId))
      .orderBy(roadmapItems.year, roadmapItems.quarter);
  }

  async getRoadmapItemsByContext(ctx: ContextFilter): Promise<RoadmapItem[]> {
    const marketCondition = ctx.marketId 
      ? eq(roadmapItems.marketId, ctx.marketId)
      : isNull(roadmapItems.marketId);
    
    return db.select().from(roadmapItems)
      .where(and(
        eq(roadmapItems.tenantDomain, ctx.tenantDomain),
        marketCondition
      ))
      .orderBy(roadmapItems.year, roadmapItems.quarter);
  }

  async createRoadmapItem(item: InsertRoadmapItem): Promise<RoadmapItem> {
    const [created] = await db.insert(roadmapItems).values(item).returning();
    return created;
  }

  async updateRoadmapItem(id: string, data: Partial<RoadmapItem>): Promise<RoadmapItem> {
    const [updated] = await db.update(roadmapItems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(roadmapItems.id, id))
      .returning();
    return updated;
  }

  async deleteRoadmapItem(id: string): Promise<void> {
    await db.delete(roadmapItems).where(eq(roadmapItems.id, id));
  }

  // Feature Recommendation methods
  async getFeatureRecommendation(id: string): Promise<FeatureRecommendation | undefined> {
    const [rec] = await db.select().from(featureRecommendations).where(eq(featureRecommendations.id, id));
    return rec || undefined;
  }

  async getFeatureRecommendationsByProduct(productId: string): Promise<FeatureRecommendation[]> {
    return db.select().from(featureRecommendations)
      .where(eq(featureRecommendations.productId, productId))
      .orderBy(desc(featureRecommendations.createdAt));
  }

  async getFeatureRecommendationsByContext(ctx: ContextFilter): Promise<FeatureRecommendation[]> {
    const marketCondition = ctx.marketId 
      ? eq(featureRecommendations.marketId, ctx.marketId)
      : isNull(featureRecommendations.marketId);
    
    return db.select().from(featureRecommendations)
      .where(and(
        eq(featureRecommendations.tenantDomain, ctx.tenantDomain),
        marketCondition
      ))
      .orderBy(desc(featureRecommendations.createdAt));
  }

  async createFeatureRecommendation(recommendation: InsertFeatureRecommendation): Promise<FeatureRecommendation> {
    const [created] = await db.insert(featureRecommendations).values(recommendation).returning();
    return created;
  }

  async updateFeatureRecommendation(id: string, data: Partial<FeatureRecommendation>): Promise<FeatureRecommendation> {
    const [updated] = await db.update(featureRecommendations)
      .set(data)
      .where(eq(featureRecommendations.id, id))
      .returning();
    return updated;
  }

  async deleteFeatureRecommendation(id: string): Promise<void> {
    await db.delete(featureRecommendations).where(eq(featureRecommendations.id, id));
  }

  async addRecommendationToRoadmap(recId: string, roadmapData: InsertRoadmapItem): Promise<{ roadmapItem: RoadmapItem; recommendation: FeatureRecommendation }> {
    return await db.transaction(async (tx) => {
      const [roadmapItem] = await tx.insert(roadmapItems).values(roadmapData).returning();
      const [recommendation] = await tx.update(featureRecommendations)
        .set({ status: "accepted" })
        .where(eq(featureRecommendations.id, recId))
        .returning();
      return { roadmapItem, recommendation };
    });
  }

  // Scheduled Job Run methods
  async createScheduledJobRun(data: InsertScheduledJobRun): Promise<ScheduledJobRun> {
    const [jobRun] = await db.insert(scheduledJobRuns).values(data).returning();
    return jobRun;
  }

  async updateScheduledJobRun(id: string, data: Partial<InsertScheduledJobRun>): Promise<ScheduledJobRun | null> {
    const [jobRun] = await db.update(scheduledJobRuns)
      .set(data)
      .where(eq(scheduledJobRuns.id, id))
      .returning();
    return jobRun || null;
  }

  async getScheduledJobRuns(limit: number = 100): Promise<ScheduledJobRun[]> {
    return await db.select().from(scheduledJobRuns)
      .orderBy(desc(scheduledJobRuns.createdAt))
      .limit(limit);
  }

  async getScheduledJobRunsByTenant(tenantDomain: string, limit: number = 50): Promise<ScheduledJobRun[]> {
    return await db.select().from(scheduledJobRuns)
      .where(eq(scheduledJobRuns.tenantDomain, tenantDomain))
      .orderBy(desc(scheduledJobRuns.createdAt))
      .limit(limit);
  }

  async getScheduledJobRunsByType(jobType: string, limit: number = 50): Promise<ScheduledJobRun[]> {
    return await db.select().from(scheduledJobRuns)
      .where(eq(scheduledJobRuns.jobType, jobType))
      .orderBy(desc(scheduledJobRuns.createdAt))
      .limit(limit);
  }

  async getRunningJobs(): Promise<ScheduledJobRun[]> {
    return await db.select().from(scheduledJobRuns)
      .where(eq(scheduledJobRuns.status, "running"))
      .orderBy(desc(scheduledJobRuns.startedAt));
  }

  // Service Plan methods
  async getServicePlan(id: string): Promise<ServicePlan | undefined> {
    const [plan] = await db.select().from(servicePlans).where(eq(servicePlans.id, id));
    return plan || undefined;
  }

  async getServicePlanByName(name: string): Promise<ServicePlan | undefined> {
    const [plan] = await db.select().from(servicePlans).where(eq(servicePlans.name, name));
    return plan || undefined;
  }

  async getAllServicePlans(): Promise<ServicePlan[]> {
    return db.select().from(servicePlans).orderBy(servicePlans.sortOrder);
  }

  async getActiveServicePlans(): Promise<ServicePlan[]> {
    return db.select().from(servicePlans)
      .where(eq(servicePlans.isActive, true))
      .orderBy(servicePlans.sortOrder);
  }

  async getDefaultServicePlan(): Promise<ServicePlan | undefined> {
    const [plan] = await db.select().from(servicePlans)
      .where(and(eq(servicePlans.isDefault, true), eq(servicePlans.isActive, true)));
    return plan || undefined;
  }

  async createServicePlan(plan: InsertServicePlan): Promise<ServicePlan> {
    const [created] = await db.insert(servicePlans).values(plan).returning();
    return created;
  }

  async updateServicePlan(id: string, data: Partial<ServicePlan>): Promise<ServicePlan> {
    const [updated] = await db.update(servicePlans)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(servicePlans.id, id))
      .returning();
    return updated;
  }

  async deleteServicePlan(id: string): Promise<void> {
    await db.delete(servicePlans).where(eq(servicePlans.id, id));
  }
}

export const storage = new DatabaseStorage();
