/**
 * Orbit Scoring Service
 * 
 * This service calculates competitive intelligence scores based on multiple factors.
 * All scores are calculated on a 0-100 scale with 2 decimal precision.
 * 
 * SCORING ALGORITHM:
 * 
 * 1. INNOVATION SCORE (0-100) - How innovative/differentiated is the positioning?
 *    - Keyword diversity: 20% weight - variety of unique keywords in messaging
 *    - Key message count: 25% weight - number of distinct value propositions
 *    - Content freshness: 20% weight - based on last analysis recency
 *    - Blog activity: 20% weight - recent blog posts indicate thought leadership
 *    - Analysis completeness: 15% weight - depth of analysis data
 * 
 * 2. MARKET PRESENCE SCORE (0-100) - How visible/established in the market?
 *    When social data is available:
 *    - Social followers: 25% weight - LinkedIn/Instagram follower counts (logarithmic scale)
 *    - Social engagement: 20% weight - posts, reactions, comments (logarithmic scale)
 *    - Website depth: 20% weight - pages crawled and content volume
 *    - Content richness: 20% weight - keyword diversity + key messages
 *    - Brand consistency: 15% weight - analysis completeness + clear messaging
 * 
 *    When social data is NOT available (adaptive weights):
 *    - Website depth: 35% weight - pages crawled and content volume
 *    - Content richness: 35% weight - keyword diversity + key messages  
 *    - Brand consistency: 30% weight - analysis completeness + clear messaging
 * 
 * 3. OVERALL ORBIT SCORE - Weighted composite:
 *    - Innovation Score: 35%
 *    - Market Presence: 35%
 *    - Content Activity: 15%
 *    - Social Engagement: 15%
 */

interface AnalysisData {
  summary?: string;
  targetAudience?: string;
  keyMessages?: string[];
  keywords?: string[];
  tone?: string;
  marketPosition?: string;
  innovationLevel?: string;
  strengths?: string[];
  weaknesses?: string[];
}

interface SocialEngagement {
  followers?: number;
  posts?: number;
  reactions?: number;
  comments?: number;
  likes?: number;
}

interface CrawlData {
  pages?: any[];
  totalWordCount?: number;
  crawledAt?: string;
}

interface BlogSnapshot {
  postCount?: number;
  latestTitles?: string[];
  capturedAt?: string;
}

export interface ScoreBreakdown {
  innovationScore: number;
  marketPresenceScore: number;
  contentActivityScore: number;
  socialEngagementScore: number;
  overallScore: number;
  factors: {
    keywordDiversity: number;
    keyMessageCount: number;
    contentFreshness: number;
    blogActivity: number;
    socialFollowers: number;
    socialEngagement: number;
    websiteCompleteness: number;
    analysisCompleteness: number;
  };
}

export function calculateScores(
  analysisData: AnalysisData | null,
  linkedInEngagement: SocialEngagement | null,
  instagramEngagement: SocialEngagement | null,
  crawlData: CrawlData | null,
  blogSnapshot: BlogSnapshot | null,
  lastAnalysis: Date | string | null
): ScoreBreakdown {
  // Initialize factor scores
  let keywordDiversity = 0;
  let keyMessageCount = 0;
  let contentFreshness = 0;
  let blogActivity = 0;
  let socialFollowers = 0;
  let socialEngagementScore = 0;
  let websiteCompleteness = 0;
  let analysisCompleteness = 0;

  // === KEYWORD DIVERSITY (0-100) ===
  if (analysisData?.keywords && Array.isArray(analysisData.keywords)) {
    const uniqueKeywords = new Set(analysisData.keywords.map(k => k.toLowerCase()));
    // Score based on number of unique keywords (cap at 15 for max score)
    keywordDiversity = Math.min(100, (uniqueKeywords.size / 15) * 100);
  }

  // === KEY MESSAGE COUNT (0-100) ===
  if (analysisData?.keyMessages && Array.isArray(analysisData.keyMessages)) {
    // Score based on number of key messages (cap at 6 for max score)
    keyMessageCount = Math.min(100, (analysisData.keyMessages.length / 6) * 100);
  }

  // === CONTENT FRESHNESS (0-100) ===
  if (lastAnalysis) {
    const analysisDate = new Date(lastAnalysis);
    const daysSinceAnalysis = (Date.now() - analysisDate.getTime()) / (1000 * 60 * 60 * 24);
    // Full score if analyzed within 7 days, linear decay to 30 days
    if (daysSinceAnalysis <= 7) {
      contentFreshness = 100;
    } else if (daysSinceAnalysis <= 30) {
      contentFreshness = 100 - ((daysSinceAnalysis - 7) / 23) * 50;
    } else {
      contentFreshness = Math.max(20, 50 - (daysSinceAnalysis - 30) / 10);
    }
  }

  // === BLOG ACTIVITY (0-100) ===
  if (blogSnapshot) {
    const postCount = blogSnapshot.postCount || 0;
    // Score based on blog post count (cap at 10 for max score)
    blogActivity = Math.min(100, (postCount / 10) * 100);
  }

  // === SOCIAL FOLLOWERS (0-100) ===
  const linkedInFollowers = linkedInEngagement?.followers || 0;
  const instagramFollowers = instagramEngagement?.followers || 0;
  const totalFollowers = linkedInFollowers + instagramFollowers;
  // Logarithmic scale: 100 followers = 20, 1000 = 40, 10000 = 60, 100000 = 80, 1000000 = 100
  if (totalFollowers > 0) {
    socialFollowers = Math.min(100, 20 * Math.log10(totalFollowers));
  }

  // === SOCIAL ENGAGEMENT (0-100) ===
  const linkedInPosts = linkedInEngagement?.posts || 0;
  const linkedInReactions = linkedInEngagement?.reactions || 0;
  const linkedInComments = linkedInEngagement?.comments || 0;
  const instagramPosts = instagramEngagement?.posts || 0;
  const instagramLikes = instagramEngagement?.likes || 0;
  const instagramComments = instagramEngagement?.comments || 0;
  const totalEngagement = linkedInPosts + linkedInReactions + linkedInComments + instagramPosts + instagramLikes + instagramComments;
  if (totalEngagement > 0) {
    socialEngagementScore = Math.min(100, 15 * Math.log10(totalEngagement + 1));
  }

  // === WEBSITE COMPLETENESS (0-100) ===
  // Handle both formats: crawlData.pages (competitor format) and crawlData.pagesCrawled (baseline format)
  const pagesArray = crawlData?.pages || (crawlData as any)?.pagesCrawled;
  if (pagesArray && Array.isArray(pagesArray)) {
    const pagesCount = pagesArray.length;
    // Score based on pages crawled (cap at 5 for max score)
    websiteCompleteness = Math.min(100, (pagesCount / 5) * 100);
  }

  // === ANALYSIS COMPLETENESS (0-100) ===
  if (analysisData) {
    let completenessPoints = 0;
    if (analysisData.summary) completenessPoints += 20;
    if (analysisData.targetAudience) completenessPoints += 20;
    if (analysisData.keyMessages?.length) completenessPoints += 20;
    if (analysisData.keywords?.length) completenessPoints += 20;
    if (analysisData.tone) completenessPoints += 10;
    if (analysisData.strengths?.length || analysisData.weaknesses?.length) completenessPoints += 10;
    analysisCompleteness = completenessPoints;
  }

  // === CALCULATE COMPOSITE SCORES ===

  // Innovation Score (weighted average of innovation factors)
  const innovationScore = (
    (keywordDiversity * 0.20) +
    (keyMessageCount * 0.25) +
    (contentFreshness * 0.20) +
    (blogActivity * 0.20) +
    (analysisCompleteness * 0.15)
  );

  // Content richness score (combines keyword diversity and key messages)
  const contentRichnessScore = (keywordDiversity * 0.5) + (keyMessageCount * 0.5);
  
  // Brand consistency score (analysis completeness + clear messaging presence)
  const brandConsistencyScore = (analysisCompleteness * 0.6) + 
    ((keyMessageCount > 0 ? 100 : 0) * 0.4);

  // Check if we have meaningful social data
  const hasSocialData = socialFollowers > 0 || socialEngagementScore > 0;

  // Market Presence Score with ADAPTIVE WEIGHTS based on data availability
  let marketPresenceScore: number;
  
  if (hasSocialData) {
    // Full formula when social data is available
    marketPresenceScore = (
      (socialFollowers * 0.25) +
      (socialEngagementScore * 0.20) +
      (websiteCompleteness * 0.20) +
      (contentRichnessScore * 0.20) +
      (brandConsistencyScore * 0.15)
    );
  } else {
    // Adaptive formula when social data is NOT available
    // Redistribute social weights to content-based factors for differentiation
    marketPresenceScore = (
      (websiteCompleteness * 0.35) +
      (contentRichnessScore * 0.35) +
      (brandConsistencyScore * 0.30)
    );
  }

  // Content Activity Score
  const contentActivityScore = (
    (contentFreshness * 0.40) +
    (blogActivity * 0.35) +
    (websiteCompleteness * 0.25)
  );

  // Social Engagement composite
  const socialComposite = (
    (socialFollowers * 0.50) +
    (socialEngagementScore * 0.50)
  );

  // Overall Orbit Score (weighted composite)
  const overallScore = (
    (innovationScore * 0.35) +
    (marketPresenceScore * 0.35) +
    (contentActivityScore * 0.15) +
    (socialComposite * 0.15)
  );

  // Round all scores to 2 decimal places
  return {
    innovationScore: Math.round(innovationScore * 100) / 100,
    marketPresenceScore: Math.round(marketPresenceScore * 100) / 100,
    contentActivityScore: Math.round(contentActivityScore * 100) / 100,
    socialEngagementScore: Math.round(socialComposite * 100) / 100,
    overallScore: Math.round(overallScore * 100) / 100,
    factors: {
      keywordDiversity: Math.round(keywordDiversity * 100) / 100,
      keyMessageCount: Math.round(keyMessageCount * 100) / 100,
      contentFreshness: Math.round(contentFreshness * 100) / 100,
      blogActivity: Math.round(blogActivity * 100) / 100,
      socialFollowers: Math.round(socialFollowers * 100) / 100,
      socialEngagement: Math.round(socialEngagementScore * 100) / 100,
      websiteCompleteness: Math.round(websiteCompleteness * 100) / 100,
      analysisCompleteness: Math.round(analysisCompleteness * 100) / 100,
    },
  };
}

/**
 * Calculate Orbit Score for a company profile (baseline)
 * Uses the same algorithm as competitor scoring but with baseline-specific data
 */
export function calculateBaselineScore(
  companyProfile: {
    description?: string | null;
    crawlData?: CrawlData | null;
    blogSnapshot?: BlogSnapshot | null;
    linkedInEngagement?: SocialEngagement | null;
    instagramEngagement?: SocialEngagement | null;
    lastCrawl?: Date | string | null;
  }
): ScoreBreakdown {
  // Extract keywords from description (simple tokenization for baseline)
  const description = companyProfile.description || "";
  const words = description.toLowerCase().split(/\W+/).filter(w => w.length > 4);
  const uniqueKeywords = Array.from(new Set(words)).slice(0, 20);
  
  // Build pseudo-analysis data from company profile
  const analysisData: AnalysisData = {
    keywords: uniqueKeywords,
    keyMessages: description ? [description.substring(0, 200)] : [],
    summary: description || undefined,
  };
  
  return calculateScores(
    analysisData,
    companyProfile.linkedInEngagement || null,
    companyProfile.instagramEngagement || null,
    companyProfile.crawlData || null,
    companyProfile.blogSnapshot || null,
    companyProfile.lastCrawl || null
  );
}

/**
 * Get the current period identifier for score history tracking
 * Uses monthly periods by default (e.g., "2026-01")
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get weekly period identifier (e.g., "2026-W04")
 */
export function getCurrentWeeklyPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
