import { storage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import { fetchLinkedInData } from "./linkedin-api";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

interface SocialMonitoringResult {
  competitorId: string;
  competitorName: string;
  platform: "linkedin" | "instagram" | "twitter";
  hasChanges: boolean;
  summary?: string;
  status: "success" | "blocked" | "error" | "no_url";
  message?: string;
  engagement?: EngagementSnapshot;
}

interface EngagementSnapshot {
  followers?: number;
  posts?: number;
  reactions?: number;
  comments?: number;
  likes?: number;
  capturedAt: string;
}

const MIN_CHANGE_THRESHOLD = 50;
const REQUEST_DELAY_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractKeySignals(html: string, platform: string): string {
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  
  // Remove numeric engagement counts to avoid false positives in content comparison
  content = content.replace(/\b\d{1,3}(,\d{3})*\s*(followers?|likes?|comments?|reactions?|posts?|connections?)\b/gi, "");
  content = content.replace(/\b\d+[KMB]?\s*(followers?|likes?|comments?|reactions?|posts?)\b/gi, "");
  
  content = content
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  
  return content.substring(0, 5000);
}

function extractEngagementMetrics(html: string, platform: string): EngagementSnapshot {
  const engagement: EngagementSnapshot = {
    capturedAt: new Date().toISOString(),
  };
  
  // Extract numbers from common patterns
  const parseNumber = (str: string): number | undefined => {
    if (!str) return undefined;
    str = str.trim().toLowerCase();
    let num = parseFloat(str.replace(/,/g, ""));
    if (str.includes("k")) num *= 1000;
    if (str.includes("m")) num *= 1000000;
    if (str.includes("b")) num *= 1000000000;
    return isNaN(num) ? undefined : Math.round(num);
  };
  
  if (platform === "linkedin") {
    // LinkedIn patterns: "1,234 followers", "12K followers"
    const followersMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*followers?/i);
    if (followersMatch) engagement.followers = parseNumber(followersMatch[1]);
    
    // Reactions/likes pattern
    const reactionsMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*(?:reactions?|likes?)/i);
    if (reactionsMatch) engagement.reactions = parseNumber(reactionsMatch[1]);
    
    // Comments pattern
    const commentsMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*comments?/i);
    if (commentsMatch) engagement.comments = parseNumber(commentsMatch[1]);
    
    // Posts pattern
    const postsMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*posts?/i);
    if (postsMatch) engagement.posts = parseNumber(postsMatch[1]);
  } else if (platform === "instagram") {
    // Instagram patterns
    const followersMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*followers?/i);
    if (followersMatch) engagement.followers = parseNumber(followersMatch[1]);
    
    const postsMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*posts?/i);
    if (postsMatch) engagement.posts = parseNumber(postsMatch[1]);
    
    const likesMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*likes?/i);
    if (likesMatch) engagement.likes = parseNumber(likesMatch[1]);
  } else if (platform === "twitter") {
    // Twitter/X patterns
    const followersMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*(?:followers?|following)/i);
    if (followersMatch) engagement.followers = parseNumber(followersMatch[1]);
    
    const postsMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*(?:posts?|tweets?)/i);
    if (postsMatch) engagement.posts = parseNumber(postsMatch[1]);
    
    const likesMatch = html.match(/(\d{1,3}(?:,\d{3})*|\d+[KMB]?)\s*likes?/i);
    if (likesMatch) engagement.likes = parseNumber(likesMatch[1]);
  }
  
  return engagement;
}

function calculateChangeScore(prev: string, next: string): number {
  if (!prev || !next) return 100;
  
  const prevWordsArr = prev.toLowerCase().split(/\s+/);
  const nextWordsArr = next.toLowerCase().split(/\s+/);
  const prevWords = new Set(prevWordsArr);
  const nextWords = new Set(nextWordsArr);
  
  const intersection = Array.from(prevWords).filter(w => nextWords.has(w)).length;
  const combined = new Set(prevWordsArr.concat(nextWordsArr));
  const union = combined.size;
  
  if (union === 0) return 0;
  const similarity = intersection / union;
  return Math.round((1 - similarity) * 100);
}

async function fetchSocialPageContent(url: string): Promise<{ content: string | null; rawHtml: string | null; blocked: boolean }> {
  try {
    await delay(REQUEST_DELAY_MS + Math.random() * 1000);
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
    
    if (response.status === 429 || response.status === 403 || response.status === 401) {
      console.warn(`Social page blocked (${response.status}): ${url}`);
      return { content: null, rawHtml: null, blocked: true };
    }
    
    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status}`);
      return { content: null, rawHtml: null, blocked: false };
    }
    
    const html = await response.text();
    
    if (html.includes("authwall") || html.includes("login-required") || html.includes("sign-in")) {
      console.warn(`Login wall detected: ${url}`);
      return { content: null, rawHtml: null, blocked: true };
    }
    
    const platform = url.includes("linkedin") ? "linkedin" : 
                     (url.includes("twitter") || url.includes("x.com")) ? "twitter" : "instagram";
    const content = extractKeySignals(html, platform);
    
    return { content, rawHtml: html, blocked: false };
  } catch (error) {
    console.error(`Error fetching social page ${url}:`, error);
    return { content: null, rawHtml: null, blocked: false };
  }
}

async function summarizeChanges(
  competitorName: string,
  platform: string,
  previousContent: string,
  newContent: string,
  changeScore: number
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Analyze changes to ${competitorName}'s ${platform} company page.

Change magnitude: ${changeScore}% different from previous

PREVIOUS (excerpt):
${previousContent.substring(0, 2000)}

CURRENT (excerpt):
${newContent.substring(0, 2000)}

Provide a 1-2 sentence summary of key changes. Focus on:
- Messaging or positioning changes
- New products/services
- Team updates
- Campaign announcements

If changes appear to be only dynamic content (dates, counters) or formatting, respond with: "No significant messaging changes detected."

Summary:`
        }
      ]
    });
    
    const textBlock = response.content.find(block => block.type === "text");
    return textBlock ? textBlock.text.trim() : "Changes detected";
  } catch (error) {
    console.error("Error summarizing changes:", error);
    return "Changes detected (summary unavailable)";
  }
}

async function fallbackToLinkedInScraping(
  competitor: any,
  results: SocialMonitoringResult[],
  updates: any,
  now: Date,
  userId?: string,
  tenantDomain?: string
): Promise<void> {
  if (!competitor.linkedInUrl) {
    return;
  }
  
  const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(competitor.linkedInUrl);
  
  if (blocked) {
    results.push({
      competitorId: competitor.id,
      competitorName: competitor.name,
      platform: "linkedin",
      hasChanges: false,
      status: "blocked",
      message: "LinkedIn requires authentication. Consider configuring RapidAPI key for reliable monitoring.",
    });
  } else if (newContent && rawHtml) {
    const previousContent = competitor.linkedInContent || "";
    const changeScore = calculateChangeScore(previousContent, newContent);
    const hasSignificantChanges = previousContent !== "" && changeScore >= MIN_CHANGE_THRESHOLD;
    
    const engagement = extractEngagementMetrics(rawHtml, "linkedin");
    updates.linkedInEngagement = engagement;
    
    let summary: string | undefined;
    if (hasSignificantChanges) {
      summary = await summarizeChanges(
        competitor.name,
        "LinkedIn",
        previousContent,
        newContent,
        changeScore
      );
      
      if (!summary.toLowerCase().includes("no significant") && tenantDomain) {
        await storage.createActivity({
          type: "social_update",
          sourceType: "competitor",
          competitorId: competitor.id,
          competitorName: competitor.name,
          description: `LinkedIn profile updated (${changeScore}% change detected)`,
          summary,
          details: {
            platform: "linkedin",
            changeScore,
            url: competitor.linkedInUrl,
          },
          date: now.toISOString(),
          impact: changeScore > 70 ? "High" : "Medium",
          userId: userId || competitor.userId,
          tenantDomain,
          marketId: competitor.marketId,
        });
      }
    }
    
    updates.linkedInContent = newContent;
    
    results.push({
      competitorId: competitor.id,
      competitorName: competitor.name,
      platform: "linkedin",
      hasChanges: hasSignificantChanges,
      summary,
      status: "success",
      engagement,
    });
  } else {
    results.push({
      competitorId: competitor.id,
      competitorName: competitor.name,
      platform: "linkedin",
      hasChanges: false,
      status: "error",
      message: "Could not fetch LinkedIn page content",
    });
  }
}

export async function monitorCompetitorSocialMedia(
  competitorId: string,
  userId?: string,
  tenantDomain?: string
): Promise<SocialMonitoringResult[]> {
  const competitor = await storage.getCompetitor(competitorId);
  if (!competitor) {
    throw new Error("Competitor not found");
  }
  
  const results: SocialMonitoringResult[] = [];
  const now = new Date();
  const updates: any = { lastSocialCrawl: now };
  
  if (competitor.linkedInUrl || competitor.url) {
    // Try RapidAPI LinkedIn Data API first if configured
    const rapidApiKey = process.env.RAPIDAPI_KEY;
    
    if (rapidApiKey) {
      try {
        const apiResult = await fetchLinkedInData(
          competitor.id,
          competitor.linkedInUrl || undefined,
          competitor.url
        );
        
        if (apiResult.success) {
          // Get previous metrics for comparison
          const previousMetricsArray = await storage.getSocialMetrics(competitor.id, "linkedin");
          const previousMetrics = previousMetricsArray.length > 0 ? previousMetricsArray[0] : null;
          const isFirstFetch = !previousMetrics || previousMetrics.followers === null;
          
          const hasFollowerChange = previousMetrics?.followers !== undefined && 
            previousMetrics.followers !== null &&
            previousMetrics.followers > 0 &&
            apiResult.followerCount !== undefined &&
            Math.abs(apiResult.followerCount - previousMetrics.followers) / previousMetrics.followers > 0.01; // 1% change threshold
          
          const hasNewPosts = apiResult.recentPosts && apiResult.recentPosts.length > 0;
          
          // Create activity on first fetch or when changes detected
          const shouldCreateActivity = hasFollowerChange || hasNewPosts || isFirstFetch;
          
          // Store metrics
          if (tenantDomain) {
            await storage.createSocialMetric({
              competitorId: competitor.id,
              tenantDomain,
              marketId: competitor.marketId || null,
              platform: "linkedin",
              period: now.toISOString().split("T")[0],
              followers: apiResult.followerCount || null,
              posts: apiResult.recentPosts?.length || null,
              engagement: apiResult.recentPosts?.reduce((sum, p) => sum + p.reactions + p.comments, 0) || null,
            });
          }
          
          let summary: string | undefined;
          if (shouldCreateActivity) {
            const changes: string[] = [];
            if (isFirstFetch && apiResult.followerCount) {
              changes.push(`Initial LinkedIn data captured: ${apiResult.followerCount.toLocaleString()} followers`);
            } else if (hasFollowerChange && previousMetrics?.followers && apiResult.followerCount) {
              const diff = apiResult.followerCount - previousMetrics.followers;
              changes.push(`Followers ${diff > 0 ? "increased" : "decreased"} by ${Math.abs(diff).toLocaleString()}`);
            }
            if (hasNewPosts && apiResult.recentPosts) {
              changes.push(`${apiResult.recentPosts.length} recent posts detected`);
              const topPost = apiResult.recentPosts[0];
              if (topPost) {
                changes.push(`Latest: "${topPost.text.substring(0, 80)}..." (${topPost.reactions} reactions)`);
              }
            }
            summary = changes.join(". ");
            
            if (tenantDomain) {
              const latestPost = apiResult.recentPosts?.[0];
              await storage.createActivity({
                type: "social_update",
                sourceType: "competitor",
                competitorId: competitor.id,
                competitorName: competitor.name,
                description: summary,
                details: {
                  platform: "linkedin",
                  followerCount: apiResult.followerCount,
                  employeeCount: apiResult.employeeCount,
                  postCount: apiResult.recentPosts?.length,
                  recentPosts: apiResult.recentPosts,
                  latestPostTitle: latestPost?.text?.substring(0, 100),
                },
                date: now.toISOString(),
                impact: hasFollowerChange ? "High" : "Medium",
                userId: userId || competitor.userId,
                tenantDomain,
                marketId: competitor.marketId,
              });
            }
          }
          
          const engagement: EngagementSnapshot & { recentPosts?: typeof apiResult.recentPosts } = {
            followers: apiResult.followerCount,
            posts: apiResult.recentPosts?.length,
            capturedAt: now.toISOString(),
            recentPosts: apiResult.recentPosts,
          };
          updates.linkedInEngagement = engagement;
          
          results.push({
            competitorId: competitor.id,
            competitorName: competitor.name,
            platform: "linkedin",
            hasChanges: !!(hasFollowerChange || hasNewPosts),
            summary,
            status: "success",
            message: "Data fetched via LinkedIn API",
            engagement,
          });
        } else {
          // API call failed, fall back to scraping
          console.log(`[Social Monitoring] LinkedIn API failed for ${competitor.name}: ${apiResult.error}, falling back to scraping`);
          await fallbackToLinkedInScraping(competitor, results, updates, now, userId, tenantDomain);
        }
      } catch (apiError: any) {
        console.error(`[Social Monitoring] LinkedIn API error for ${competitor.name}:`, apiError);
        await fallbackToLinkedInScraping(competitor, results, updates, now, userId, tenantDomain);
      }
    } else if (competitor.linkedInUrl) {
      // No API key configured, use scraping
      await fallbackToLinkedInScraping(competitor, results, updates, now, userId, tenantDomain);
    }
  }
  
  if (competitor.instagramUrl) {
    const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(competitor.instagramUrl);
    
    if (blocked) {
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "instagram",
        hasChanges: false,
        status: "blocked",
        message: "Instagram requires authentication. Consider using official Instagram API for reliable monitoring.",
      });
    } else if (newContent && rawHtml) {
      const previousContent = competitor.instagramContent || "";
      const changeScore = calculateChangeScore(previousContent, newContent);
      const hasSignificantChanges = previousContent !== "" && changeScore >= MIN_CHANGE_THRESHOLD;
      
      // Extract and store engagement metrics (snapshot only, no change alerts)
      const engagement = extractEngagementMetrics(rawHtml, "instagram");
      updates.instagramEngagement = engagement;
      
      let summary: string | undefined;
      if (hasSignificantChanges) {
        summary = await summarizeChanges(
          competitor.name,
          "Instagram",
          previousContent,
          newContent,
          changeScore
        );
        
        if (!summary.toLowerCase().includes("no significant")) {
          await storage.createActivity({
            type: "social_update",
            sourceType: "competitor",
            competitorId: competitor.id,
            competitorName: competitor.name,
            description: `Instagram profile updated (${changeScore}% change detected)`,
            summary,
            details: {
              platform: "instagram",
              changeScore,
              url: competitor.instagramUrl,
            },
            date: now.toISOString(),
            impact: changeScore > 70 ? "High" : "Medium",
            userId: userId || competitor.userId,
            tenantDomain,
            marketId: competitor.marketId,
          });
        }
      }
      
      updates.instagramContent = newContent;
      
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "instagram",
        hasChanges: hasSignificantChanges,
        summary,
        status: "success",
        engagement,
      });
    } else {
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "instagram",
        hasChanges: false,
        status: "error",
        message: "Could not fetch Instagram page content",
      });
    }
  }
  
  // Twitter/X monitoring
  if (competitor.twitterUrl) {
    const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(competitor.twitterUrl);
    
    if (blocked) {
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "twitter",
        hasChanges: false,
        status: "blocked",
        message: "Twitter/X requires authentication. Consider using official Twitter API for reliable monitoring.",
      });
    } else if (newContent && rawHtml) {
      const previousContent = competitor.twitterContent || "";
      const changeScore = calculateChangeScore(previousContent, newContent);
      const hasSignificantChanges = previousContent !== "" && changeScore >= MIN_CHANGE_THRESHOLD;
      
      const engagement = extractEngagementMetrics(rawHtml, "twitter");
      updates.twitterEngagement = engagement;
      
      let summary: string | undefined;
      if (hasSignificantChanges) {
        summary = await summarizeChanges(
          competitor.name,
          "Twitter/X",
          previousContent,
          newContent,
          changeScore
        );
        
        if (!summary.toLowerCase().includes("no significant")) {
          await storage.createActivity({
            type: "social_update",
            sourceType: "competitor",
            competitorId: competitor.id,
            competitorName: competitor.name,
            description: `Twitter/X profile updated (${changeScore}% change detected)`,
            summary,
            details: {
              platform: "twitter",
              changeScore,
              url: competitor.twitterUrl,
            },
            date: now.toISOString(),
            impact: changeScore > 70 ? "High" : "Medium",
            userId: userId || competitor.userId,
            tenantDomain,
            marketId: competitor.marketId,
          });
        }
      }
      
      updates.twitterContent = newContent;
      
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "twitter",
        hasChanges: hasSignificantChanges,
        summary,
        status: "success",
        engagement,
      });
    } else {
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        platform: "twitter",
        hasChanges: false,
        status: "error",
        message: "Could not fetch Twitter/X page content",
      });
    }
  }
  
  await storage.updateCompetitor(competitorId, updates);
  
  return results;
}

interface CompanyProfileSocialResult {
  companyProfileId: string;
  companyName: string;
  platform: "linkedin" | "instagram" | "twitter";
  hasChanges: boolean;
  summary?: string;
  status: "success" | "blocked" | "error" | "no_url";
  message?: string;
  engagement?: EngagementSnapshot;
}

export async function monitorCompanyProfileSocialMedia(
  companyProfileId: string,
  userId: string,
  tenantDomain: string,
  marketId?: string
): Promise<CompanyProfileSocialResult[]> {
  const companyProfile = await storage.getCompanyProfile(companyProfileId);
  if (!companyProfile) {
    throw new Error("Company profile not found");
  }
  
  const results: CompanyProfileSocialResult[] = [];
  const now = new Date();
  const updates: any = { lastSocialCrawl: now };
  
  if (companyProfile.linkedInUrl || companyProfile.websiteUrl) {
    // Try RapidAPI LinkedIn Data API first if configured (same as competitors)
    const rapidApiKey = process.env.RAPIDAPI_KEY;
    console.log(`[Social Monitor] Company profile ${companyProfile.companyName}: RAPIDAPI_KEY=${rapidApiKey ? 'configured' : 'missing'}, linkedInUrl=${companyProfile.linkedInUrl || 'none'}`);
    
    if (rapidApiKey) {
      try {
        console.log(`[Social Monitor] Calling fetchLinkedInData for ${companyProfile.linkedInUrl || companyProfile.websiteUrl}`);
        const apiResult = await fetchLinkedInData(
          companyProfile.id,
          companyProfile.linkedInUrl || undefined,
          companyProfile.websiteUrl
        );
        console.log(`[Social Monitor] LinkedIn API result: success=${apiResult.success}, followers=${apiResult.followerCount || 0}, error=${apiResult.error || 'none'}`);
        
        if (apiResult.success) {
          // Get previous metrics for comparison from linkedInEngagement stored on profile
          const previousEngagement = companyProfile.linkedInEngagement as any;
          const previousFollowers = previousEngagement?.followers || 0;
          const isFirstFetch = previousFollowers === 0;
          
          const hasFollowerChange = previousFollowers > 0 && 
            apiResult.followerCount !== undefined &&
            Math.abs(apiResult.followerCount - previousFollowers) / previousFollowers > 0.01; // 1% change threshold
          
          const hasNewPosts = apiResult.recentPosts && apiResult.recentPosts.length > 0;
          
          // Create initial activity on first successful fetch
          const shouldCreateActivity = hasFollowerChange || hasNewPosts || isFirstFetch;
          
          // Build engagement data
          const engagement: EngagementSnapshot = {
            followers: apiResult.followerCount,
            posts: apiResult.recentPosts?.length || 0,
            reactions: apiResult.recentPosts?.reduce((sum, p) => sum + p.reactions, 0) || 0,
            comments: apiResult.recentPosts?.reduce((sum, p) => sum + p.comments, 0) || 0,
            capturedAt: now.toISOString(),
          };
          updates.linkedInEngagement = engagement;
          
          let summary: string | undefined;
          if (shouldCreateActivity) {
            const changes: string[] = [];
            if (isFirstFetch && apiResult.followerCount) {
              changes.push(`Initial LinkedIn data captured: ${apiResult.followerCount.toLocaleString()} followers`);
            } else if (hasFollowerChange && apiResult.followerCount) {
              const diff = apiResult.followerCount - previousFollowers;
              changes.push(`Followers ${diff > 0 ? "increased" : "decreased"} by ${Math.abs(diff).toLocaleString()}`);
            }
            if (hasNewPosts && apiResult.recentPosts) {
              changes.push(`${apiResult.recentPosts.length} recent posts detected`);
              const topPost = apiResult.recentPosts[0];
              if (topPost) {
                changes.push(`Latest: "${topPost.text.substring(0, 80)}..." (${topPost.reactions} reactions)`);
              }
            }
            summary = changes.join(". ");
            
            await storage.createActivity({
              type: "social_update",
              sourceType: "baseline",
              companyProfileId: companyProfile.id,
              competitorName: companyProfile.companyName,
              description: summary,
              details: {
                platform: "linkedin",
                followerCount: apiResult.followerCount,
                employeeCount: apiResult.employeeCount,
                postCount: apiResult.recentPosts?.length,
                recentPosts: apiResult.recentPosts,
              },
              date: now.toISOString(),
              impact: hasFollowerChange ? "High" : "Medium",
              userId,
              tenantDomain,
              marketId: marketId || companyProfile.marketId || undefined,
            });
          }
          
          results.push({
            companyProfileId: companyProfile.id,
            companyName: companyProfile.companyName,
            platform: "linkedin",
            hasChanges: !!summary,
            summary,
            status: "success",
            message: `Followers: ${apiResult.followerCount?.toLocaleString() || 'N/A'}, Posts: ${apiResult.recentPosts?.length || 0}`,
            engagement,
          });
        } else {
          console.log(`[Social Monitor] LinkedIn API failed for baseline ${companyProfile.companyName}: ${apiResult.error}`);
          results.push({
            companyProfileId: companyProfile.id,
            companyName: companyProfile.companyName,
            platform: "linkedin",
            hasChanges: false,
            status: "error",
            message: apiResult.error || "Failed to fetch LinkedIn data",
          });
        }
      } catch (error: any) {
        console.error(`[Social Monitor] LinkedIn API error for baseline ${companyProfile.companyName}:`, error);
        results.push({
          companyProfileId: companyProfile.id,
          companyName: companyProfile.companyName,
          platform: "linkedin",
          hasChanges: false,
          status: "error",
          message: error.message,
        });
      }
    } else {
      // No RapidAPI key - fall back to basic scraping (will likely be blocked)
      const linkedInUrl = companyProfile.linkedInUrl;
      if (linkedInUrl) {
        const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(linkedInUrl);
        
        if (blocked) {
          results.push({
            companyProfileId: companyProfile.id,
            companyName: companyProfile.companyName,
            platform: "linkedin",
            hasChanges: false,
            status: "blocked",
            message: "LinkedIn requires authentication. Configure RAPIDAPI_KEY for better results.",
          });
        } else if (newContent && rawHtml) {
          const engagement = extractEngagementMetrics(rawHtml, "linkedin");
          updates.linkedInEngagement = engagement;
          results.push({
            companyProfileId: companyProfile.id,
            companyName: companyProfile.companyName,
            platform: "linkedin",
            hasChanges: false,
            status: "success",
            engagement,
          });
        }
      }
    }
  }
  
  if (companyProfile.instagramUrl) {
    const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(companyProfile.instagramUrl);
    
    if (blocked) {
      results.push({
        companyProfileId: companyProfile.id,
        companyName: companyProfile.companyName,
        platform: "instagram",
        hasChanges: false,
        status: "blocked",
        message: "Instagram requires authentication.",
      });
    } else if (newContent && rawHtml) {
      const previousContent = companyProfile.instagramContent || "";
      const changeScore = calculateChangeScore(previousContent, newContent);
      const hasSignificantChanges = previousContent !== "" && changeScore >= MIN_CHANGE_THRESHOLD;
      
      const engagement = extractEngagementMetrics(rawHtml, "instagram");
      updates.instagramEngagement = engagement;
      
      let summary: string | undefined;
      if (hasSignificantChanges) {
        summary = await summarizeChanges(companyProfile.companyName, "Instagram", previousContent, newContent, changeScore);
        
        if (!summary.toLowerCase().includes("no significant")) {
          await storage.createActivity({
            type: "social_update",
            sourceType: "baseline",
            companyProfileId: companyProfile.id,
            competitorName: companyProfile.companyName,
            description: `Your Instagram profile was updated (${changeScore}% change detected)`,
            summary,
            details: { platform: "instagram", changeScore, url: companyProfile.instagramUrl },
            date: now.toISOString(),
            impact: changeScore > 70 ? "High" : "Medium",
            userId,
            tenantDomain,
            marketId: marketId || companyProfile.marketId || undefined,
          });
        }
      }
      
      updates.instagramContent = newContent;
      results.push({
        companyProfileId: companyProfile.id,
        companyName: companyProfile.companyName,
        platform: "instagram",
        hasChanges: hasSignificantChanges,
        summary,
        status: "success",
        engagement,
      });
    }
  }
  
  if (companyProfile.twitterUrl) {
    const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(companyProfile.twitterUrl);
    
    if (blocked) {
      results.push({
        companyProfileId: companyProfile.id,
        companyName: companyProfile.companyName,
        platform: "twitter",
        hasChanges: false,
        status: "blocked",
        message: "Twitter/X requires authentication.",
      });
    } else if (newContent && rawHtml) {
      const previousContent = companyProfile.twitterContent || "";
      const changeScore = calculateChangeScore(previousContent, newContent);
      const hasSignificantChanges = previousContent !== "" && changeScore >= MIN_CHANGE_THRESHOLD;
      
      const engagement = extractEngagementMetrics(rawHtml, "twitter");
      updates.twitterEngagement = engagement;
      
      let summary: string | undefined;
      if (hasSignificantChanges) {
        summary = await summarizeChanges(companyProfile.companyName, "Twitter/X", previousContent, newContent, changeScore);
        
        if (!summary.toLowerCase().includes("no significant")) {
          await storage.createActivity({
            type: "social_update",
            sourceType: "baseline",
            companyProfileId: companyProfile.id,
            competitorName: companyProfile.companyName,
            description: `Your Twitter/X profile was updated (${changeScore}% change detected)`,
            summary,
            details: { platform: "twitter", changeScore, url: companyProfile.twitterUrl },
            date: now.toISOString(),
            impact: changeScore > 70 ? "High" : "Medium",
            userId,
            tenantDomain,
            marketId: marketId || companyProfile.marketId || undefined,
          });
        }
      }
      
      updates.twitterContent = newContent;
      results.push({
        companyProfileId: companyProfile.id,
        companyName: companyProfile.companyName,
        platform: "twitter",
        hasChanges: hasSignificantChanges,
        summary,
        status: "success",
        engagement,
      });
    }
  }
  
  await storage.updateCompanyProfile(companyProfileId, updates);
  
  return results;
}

// Product-level social monitoring result
interface ProductSocialResult {
  productId: string;
  productName: string;
  platform: "linkedin" | "instagram" | "twitter";
  hasChanges: boolean;
  summary?: string;
  status: "success" | "blocked" | "error";
  message?: string;
  engagement?: EngagementSnapshot;
}

export async function monitorProductSocialMedia(
  productId: string,
  userId: string,
  tenantDomain: string,
  marketId?: string
): Promise<ProductSocialResult[]> {
  const product = await storage.getProduct(productId);
  if (!product) {
    throw new Error("Product not found");
  }
  
  const results: ProductSocialResult[] = [];
  const now = new Date();
  const updates: any = { lastSocialCrawl: now, updatedAt: now };
  
  // Monitor LinkedIn
  if (product.linkedInUrl) {
    const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(product.linkedInUrl);
    
    if (blocked) {
      results.push({
        productId: product.id,
        productName: product.name,
        platform: "linkedin",
        hasChanges: false,
        status: "blocked",
        message: "LinkedIn requires authentication.",
      });
    } else if (newContent && rawHtml) {
      const engagement = extractEngagementMetrics(rawHtml, "linkedin");
      
      results.push({
        productId: product.id,
        productName: product.name,
        platform: "linkedin",
        hasChanges: false,
        status: "success",
        engagement,
      });
    }
  }
  
  // Monitor Instagram
  if (product.instagramUrl) {
    const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(product.instagramUrl);
    
    if (blocked) {
      results.push({
        productId: product.id,
        productName: product.name,
        platform: "instagram",
        hasChanges: false,
        status: "blocked",
        message: "Instagram requires authentication.",
      });
    } else if (newContent && rawHtml) {
      const engagement = extractEngagementMetrics(rawHtml, "instagram");
      
      results.push({
        productId: product.id,
        productName: product.name,
        platform: "instagram",
        hasChanges: false,
        status: "success",
        engagement,
      });
    }
  }
  
  // Monitor Twitter
  if (product.twitterUrl) {
    const { content: newContent, rawHtml, blocked } = await fetchSocialPageContent(product.twitterUrl);
    
    if (blocked) {
      results.push({
        productId: product.id,
        productName: product.name,
        platform: "twitter",
        hasChanges: false,
        status: "blocked",
        message: "Twitter/X requires authentication.",
      });
    } else if (newContent && rawHtml) {
      const engagement = extractEngagementMetrics(rawHtml, "twitter");
      
      results.push({
        productId: product.id,
        productName: product.name,
        platform: "twitter",
        hasChanges: false,
        status: "success",
        engagement,
      });
    }
  }
  
  await storage.updateProduct(productId, updates);
  
  return results;
}

export async function monitorAllCompetitorsForTenant(
  tenantDomain: string
): Promise<SocialMonitoringResult[]> {
  const tenant = await storage.getTenantByDomain(tenantDomain);
  if (!tenant) {
    throw new Error("Tenant not found");
  }
  
  if (tenant.plan === "free") {
    throw new Error("Social media monitoring is a premium feature. Please upgrade your plan to access this functionality.");
  }
  
  const users = await storage.getUsersByDomain(tenantDomain);
  const allResults: SocialMonitoringResult[] = [];
  
  for (const user of users) {
    const competitors = await storage.getCompetitorsByUserId(user.id);
    
    for (const competitor of competitors) {
      if (competitor.linkedInUrl || competitor.instagramUrl || competitor.twitterUrl) {
        try {
          const results = await monitorCompetitorSocialMedia(competitor.id, user.id, tenantDomain);
          allResults.push(...results);
        } catch (error) {
          console.error(`Error monitoring competitor ${competitor.id}:`, error);
        }
      }
    }
  }
  
  return allResults;
}
