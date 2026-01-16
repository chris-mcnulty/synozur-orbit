import { 
  users, 
  competitors, 
  activity, 
  recommendations, 
  reports, 
  analysis,
  groundingDocuments,
  companyProfiles,
  assessments,
  type User, 
  type InsertUser,
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
  type CompanyProfile,
  type InsertCompanyProfile,
  type Assessment,
  type InsertAssessment
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getGlobalAdmin(): Promise<User | undefined>;
  getDomainAdmin(domain: string): Promise<User | undefined>;
  
  // Competitor methods
  getCompetitor(id: string): Promise<Competitor | undefined>;
  getAllCompetitors(): Promise<Competitor[]>;
  getCompetitorsByUserId(userId: string): Promise<Competitor[]>;
  createCompetitor(competitor: InsertCompetitor): Promise<Competitor>;
  updateCompetitorLastCrawl(id: string, lastCrawl: string): Promise<void>;
  updateCompetitorAnalysis(id: string, analysisData: any): Promise<void>;
  deleteCompetitor(id: string): Promise<void>;
  
  // Activity methods
  getAllActivity(): Promise<Activity[]>;
  createActivity(activity: InsertActivity): Promise<Activity>;
  
  // Recommendation methods
  getAllRecommendations(): Promise<Recommendation[]>;
  createRecommendation(recommendation: InsertRecommendation): Promise<Recommendation>;
  
  // Report methods
  getAllReports(): Promise<Report[]>;
  createReport(report: InsertReport): Promise<Report>;
  
  // Analysis methods
  getLatestAnalysis(): Promise<Analysis | undefined>;
  getLatestAnalysisByTenant(tenantDomain: string): Promise<Analysis | undefined>;
  createAnalysis(analysis: InsertAnalysis): Promise<Analysis>;
  
  // Grounding Document methods
  getGroundingDocument(id: string): Promise<GroundingDocument | undefined>;
  getGroundingDocumentsByTenant(tenantDomain: string): Promise<GroundingDocument[]>;
  getGroundingDocumentsByCompetitor(competitorId: string): Promise<GroundingDocument[]>;
  createGroundingDocument(document: InsertGroundingDocument): Promise<GroundingDocument>;
  updateGroundingDocumentText(id: string, extractedText: string): Promise<void>;
  deleteGroundingDocument(id: string): Promise<void>;
  
  // Company Profile methods (baseline own website)
  getCompanyProfile(id: string): Promise<CompanyProfile | undefined>;
  getCompanyProfileByTenant(tenantDomain: string): Promise<CompanyProfile | undefined>;
  createCompanyProfile(profile: InsertCompanyProfile): Promise<CompanyProfile>;
  updateCompanyProfile(id: string, data: Partial<CompanyProfile>): Promise<CompanyProfile>;
  deleteCompanyProfile(id: string): Promise<void>;
  
  // Assessment methods (snapshots for comparison)
  getAssessment(id: string): Promise<Assessment | undefined>;
  getAssessmentsByTenant(tenantDomain: string): Promise<Assessment[]>;
  getAssessmentsByUser(userId: string): Promise<Assessment[]>;
  createAssessment(assessment: InsertAssessment): Promise<Assessment>;
  updateAssessment(id: string, data: Partial<Assessment>): Promise<Assessment>;
  deleteAssessment(id: string): Promise<void>;
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

  async createCompetitor(insertCompetitor: InsertCompetitor): Promise<Competitor> {
    const [competitor] = await db
      .insert(competitors)
      .values(insertCompetitor)
      .returning();
    return competitor;
  }

  async updateCompetitorLastCrawl(id: string, lastCrawl: string): Promise<void> {
    await db
      .update(competitors)
      .set({ lastCrawl })
      .where(eq(competitors.id, id));
  }

  async updateCompetitorAnalysis(id: string, analysisData: any): Promise<void> {
    await db
      .update(competitors)
      .set({ analysisData })
      .where(eq(competitors.id, id));
  }

  async deleteCompetitor(id: string): Promise<void> {
    await db.delete(competitors).where(eq(competitors.id, id));
  }

  // Activity methods
  async getAllActivity(): Promise<Activity[]> {
    return await db.select().from(activity).orderBy(desc(activity.createdAt));
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

  async createRecommendation(insertRecommendation: InsertRecommendation): Promise<Recommendation> {
    const [recommendation] = await db
      .insert(recommendations)
      .values(insertRecommendation)
      .returning();
    return recommendation;
  }

  // Report methods
  async getAllReports(): Promise<Report[]> {
    return await db.select().from(reports).orderBy(desc(reports.createdAt));
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

  // Company Profile methods (baseline own website)
  async getCompanyProfile(id: string): Promise<CompanyProfile | undefined> {
    const [profile] = await db.select().from(companyProfiles).where(eq(companyProfiles.id, id));
    return profile || undefined;
  }

  async getCompanyProfileByTenant(tenantDomain: string): Promise<CompanyProfile | undefined> {
    const [profile] = await db.select().from(companyProfiles).where(eq(companyProfiles.tenantDomain, tenantDomain));
    return profile || undefined;
  }

  async createCompanyProfile(insertProfile: InsertCompanyProfile): Promise<CompanyProfile> {
    const [profile] = await db
      .insert(companyProfiles)
      .values(insertProfile)
      .returning();
    return profile;
  }

  async updateCompanyProfile(id: string, data: Partial<CompanyProfile>): Promise<CompanyProfile> {
    const [profile] = await db
      .update(companyProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(companyProfiles.id, id))
      .returning();
    return profile;
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
}

export const storage = new DatabaseStorage();
