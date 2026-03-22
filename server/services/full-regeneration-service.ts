import { storage } from "../storage";
import { analyzeCompetitorWebsite, generateGapAnalysis, generateRecommendations, type CompetitorAnalysis, type LinkedInContext } from "../ai-service";
import { sendEmail, wrapEmailContent } from "./email-service";
import { calculateScores } from "./scoring-service";
import { crawlCompetitorWebsite, getCombinedContent } from "./web-crawler";
import { monitorCompetitorSocialMedia as monitorSocialMedia, monitorCompanyProfileSocialMedia } from "./social-monitoring";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

interface RegenerationProgress {
  status: "pending" | "running" | "completed" | "failed";
  currentStep: string;
  stepsCompleted: number;
  totalSteps: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

const activeJobs = new Map<string, RegenerationProgress>();

export function getRegenerationStatus(jobId: string): RegenerationProgress | null {
  return activeJobs.get(jobId) || null;
}

export async function startFullRegeneration(
  userId: string,
  tenantDomain: string,
  userEmail: string,
  userName: string,
  marketId?: string
): Promise<string> {
  const jobId = `regen_${tenantDomain}_${Date.now()}`;
  
  const progress: RegenerationProgress = {
    status: "pending",
    currentStep: "Initializing",
    stepsCompleted: 0,
    totalSteps: 9,
    startedAt: new Date(),
  };
  
  activeJobs.set(jobId, progress);
  
  runRegenerationInBackground(jobId, userId, tenantDomain, userEmail, userName, marketId);
  
  return jobId;
}

async function runRegenerationInBackground(
  jobId: string,
  userId: string,
  tenantDomain: string,
  userEmail: string,
  userName: string,
  marketId?: string
): Promise<void> {
  const progress = activeJobs.get(jobId)!;
  progress.status = "running";
  
  const results: {
    competitorsAnalyzed: number;
    battlecardsGenerated: number;
    gapsIdentified: number;
    recommendationsGenerated: number;
    gtmPlanGenerated: boolean;
    messagingFrameworkGenerated: boolean;
    marketingTasksGenerated: number;
  } = {
    competitorsAnalyzed: 0,
    battlecardsGenerated: 0,
    gapsIdentified: 0,
    recommendationsGenerated: 0,
    gtmPlanGenerated: false,
    messagingFrameworkGenerated: false,
    marketingTasksGenerated: 0,
  };

  try {
    const user = await storage.getUser(userId);
    if (!user) throw new Error("User not found");

    // Get tenant to build complete context filter
    const tenant = await storage.getTenantByDomain(tenantDomain);
    if (!tenant) throw new Error("Tenant not found");
    
    // Build context filter for market-scoped queries
    const contextFilter = { tenantId: tenant.id, tenantDomain, marketId: marketId || "" };
    
    const companyProfile = await storage.getCompanyProfileByContext(contextFilter);
    const competitors = await storage.getCompetitorsByContext(contextFilter);
    const groundingDocs = await storage.getGroundingDocumentsByContext(contextFilter);
    const groundingContext = groundingDocs
      .filter(doc => doc.extractedText)
      .map(doc => doc.extractedText)
      .join("\n\n");

    // Step 1: Crawl baseline company profile website and social media
    progress.currentStep = "Refreshing baseline data";
    progress.stepsCompleted = 1;

    if (companyProfile && companyProfile.websiteUrl) {
      try {
        console.log(`Full regen: Crawling baseline website for ${companyProfile.companyName}...`);
        const crawlResult = await crawlCompetitorWebsite(companyProfile.websiteUrl);
        
        if (crawlResult.pages.length > 0) {
          const combinedContent = getCombinedContent(crawlResult);
          
          // Update company profile with crawl data
          await storage.updateCompanyProfile(companyProfile.id, {
            crawlData: {
              pagesCrawled: crawlResult.pages.map(p => ({
                url: p.url,
                pageType: p.pageType,
                title: p.title,
                wordCount: p.wordCount,
              })),
              totalWordCount: crawlResult.pages.reduce((sum, p) => sum + p.wordCount, 0),
              crawledAt: crawlResult.crawledAt,
            },
            previousWebsiteContent: combinedContent.substring(0, 100000),
            lastCrawl: new Date().toISOString(),
            lastFullCrawl: new Date(),
          });
          console.log(`Full regen: Baseline website crawled - ${crawlResult.pages.length} pages`);
        }
      } catch (error) {
        console.error(`Full regen: Failed to crawl baseline website:`, error);
      }
      
      // Also refresh LinkedIn data if URL is configured
      if (companyProfile.linkedInUrl) {
        try {
          console.log(`Full regen: Refreshing baseline LinkedIn data...`);
          await monitorCompanyProfileSocialMedia(
            companyProfile.id,
            userId,
            tenantDomain,
            marketId || companyProfile.marketId || undefined
          );
          console.log(`Full regen: Baseline LinkedIn data refreshed`);
        } catch (error) {
          console.error(`Full regen: Failed to refresh baseline social:`, error);
        }
      }
    }

    progress.currentStep = "Analyzing competitors";
    progress.stepsCompleted = 2;

    let ourPositioning = companyProfile 
      ? `${companyProfile.companyName}: ${companyProfile.description || 'No description provided'}`
      : "Our company positioning";
    
    if (groundingContext) {
      ourPositioning += `\n\nAdditional context from positioning documents:\n${groundingContext.slice(0, 5000)}`;
    }

    const analyses: any[] = [];
    for (const competitor of competitors) {
      try {
        // Check if competitor has manual research that should be preserved
        const existingAnalysis = competitor.analysisData as any;
        const hasManualResearch = existingAnalysis?.source === "manual";
        
        if (hasManualResearch) {
          // Skip re-crawling - preserve manual research data
          console.log(`Full regen: Preserving manual research for ${competitor.name}`);
          analyses.push({ competitor: competitor.name, ...existingAnalysis });
          results.competitorsAnalyzed++;
          continue;
        }
        
        const response = await fetch(competitor.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; OrbitBot/1.0)" },
        });
        let content = await response.text();
        content = content
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (content.length > 100) {
          // Extract LinkedIn data from competitor record if available
          const linkedInEngagement = competitor.linkedInEngagement as {
            followers?: number;
            posts?: number;
            employees?: number;
            recentPosts?: Array<{ text: string; reactions?: number; comments?: number }>;
          } | null;
          
          const linkedInData: LinkedInContext | undefined = linkedInEngagement ? {
            followerCount: linkedInEngagement.followers,
            employeeCount: linkedInEngagement.employees,
            recentPosts: linkedInEngagement.recentPosts,
          } : undefined;
          
          const analysis = await analyzeCompetitorWebsite(
            competitor.name,
            competitor.url,
            content,
            undefined, // grounding context
            linkedInData
          );
          await storage.updateCompetitorAnalysis(competitor.id, analysis);
          await storage.updateCompetitorLastCrawl(competitor.id, new Date().toLocaleString());
          analyses.push({ competitor: competitor.name, ...analysis });
          results.competitorsAnalyzed++;
        }
      } catch (e) {
        console.error(`Full regen: Failed to analyze ${competitor.name}:`, e);
      }
    }

    // Calculate and store competitor scores after analysis
    progress.currentStep = "Calculating competitor scores";
    for (const competitor of competitors) {
      try {
        const refreshedCompetitor = await storage.getCompetitor(competitor.id);
        if (refreshedCompetitor) {
          const scores = calculateScores(
            refreshedCompetitor.analysisData as any,
            refreshedCompetitor.linkedInEngagement as any,
            refreshedCompetitor.instagramEngagement as any,
            refreshedCompetitor.crawlData as any,
            refreshedCompetitor.blogSnapshot as any,
            refreshedCompetitor.lastCrawl ? new Date(refreshedCompetitor.lastCrawl) : null
          );
          
          // Store the competitive score in analysisData
          const existingAnalysis = refreshedCompetitor.analysisData as any || {};
          await storage.updateCompetitorAnalysis(competitor.id, {
            ...existingAnalysis,
            competitiveScore: scores.overallScore,
            innovationScore: scores.innovationScore,
            marketPresenceScore: scores.marketPresenceScore,
            contentActivityScore: scores.contentActivityScore,
            socialEngagementScore: scores.socialEngagementScore,
            scoreFactors: scores.factors,
            scoredAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.error(`Full regen: Failed to calculate scores for ${competitor.name}:`, e);
      }
    }

    progress.currentStep = "Generating gap analysis";
    progress.stepsCompleted = 2;

    const baselineAnalysis = companyProfile?.analysisData as CompetitorAnalysis | undefined;
    const gaps = await generateGapAnalysis(
      ourPositioning,
      analyses,
      baselineAnalysis,
      groundingContext || undefined
    );
    results.gapsIdentified = gaps.length;

    // Fetch existing recommendations with feedback scores for AI learning
    const existingRecs = await storage.getRecommendationsByTenant(tenantDomain);
    const existingForAI = existingRecs
      .filter(r => !marketId || r.marketId === marketId || !r.marketId)
      .map(r => ({
        title: r.title,
        description: r.description,
        area: r.area,
        status: r.status,
        dismissedReason: r.dismissedReason || undefined,
        thumbsUp: r.thumbsUp || 0,
        thumbsDown: r.thumbsDown || 0,
      }));

    const recommendations = await generateRecommendations(gaps, analyses, existingForAI);
    results.recommendationsGenerated = recommendations.length;

    for (const rec of recommendations) {
      await storage.createRecommendation({
        title: rec.title,
        description: rec.description,
        area: rec.area,
        impact: rec.impact,
        userId: userId,
        tenantDomain,
        marketId: marketId || null,
      });
    }

    const ourAnalysisData = companyProfile?.analysisData as any;
    const ourSummary = ourAnalysisData?.summary || companyProfile?.description || "Our positioning";
    const ourKeyMessages = ourAnalysisData?.keyMessages || [];

    // Build themes from competitor keywords/key positioning - use each competitor's own analysisData
    // This avoids index alignment issues if some analyses fail
    const competitorThemes = competitors.flatMap((comp) => {
      const compAnalysis = comp.analysisData as any;
      if (!compAnalysis) return [];
      const keywords = compAnalysis.keywords || [];
      return keywords.slice(0, 3).map((keyword: string) => ({
        theme: keyword,
        description: `${comp.name} emphasizes "${keyword}" in their positioning`,
        competitorName: comp.name,
        source: 'keyword',
      }));
    }).slice(0, 12);

    // Build messaging comparison with explicit competitor names - use each competitor's own analysisData
    const messagingComparisons = competitors.slice(0, 5).map((comp, i) => {
      const compAnalysis = comp.analysisData as any;
      return {
        category: compAnalysis?.targetAudience || "Market Positioning",
        competitorName: comp.name,
        us: ourKeyMessages[i] || ourSummary,
        competitorMessage: compAnalysis?.keyMessages?.[0] || compAnalysis?.valueProposition || "",
      };
    }).filter(m => m.competitorMessage);

    await storage.createAnalysis({
      userId: userId,
      tenantDomain,
      marketId: marketId || null,
      themes: competitorThemes,
      messaging: messagingComparisons,
      gaps: gaps,
    });

    progress.currentStep = "Generating battlecards";
    progress.stepsCompleted = 3;

    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });

    for (const competitor of competitors) {
      try {
        const competitorAnalysis = competitor.analysisData as any;
        const prompt = `You are a competitive intelligence analyst. Generate a comprehensive sales battlecard for competing against "${competitor.name}".

Our Company: ${companyProfile?.companyName || "Our Company"}
Our Positioning: ${ourPositioning.slice(0, 2000)}

Competitor: ${competitor.name}
Competitor URL: ${competitor.url}
${competitorAnalysis ? `Competitor Analysis: ${JSON.stringify(competitorAnalysis).slice(0, 2000)}` : ""}

Generate a battlecard with the following sections in valid JSON format:
{
  "strengths": ["Their strength 1", "Their strength 2", "Their strength 3"],
  "weaknesses": ["Their weakness 1", "Their weakness 2", "Their weakness 3"],
  "ourAdvantages": ["Our advantage 1", "Our advantage 2", "Our advantage 3"],
  "objections": [
    {"objection": "Common objection", "response": "How to respond"}
  ],
  "talkTracks": ["Sales talk track 1", "Sales talk track 2"],
  "quickStats": {"marketPosition": "Description", "targetMarket": "Description", "pricingModel": "Description"}
}

Return ONLY valid JSON.`;

        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        });

        const content = message.content[0];
        if (content.type === "text") {
          let text = content.text.trim();
          if (text.startsWith("```json")) text = text.slice(7);
          else if (text.startsWith("```")) text = text.slice(3);
          if (text.endsWith("```")) text = text.slice(0, -3);

          const battlecardContent = JSON.parse(text.trim());
          
          const existingBattlecard = await storage.getBattlecardByCompetitor(competitor.id);
          if (existingBattlecard) {
            await storage.updateBattlecard(existingBattlecard.id, {
              strengths: battlecardContent.strengths,
              weaknesses: battlecardContent.weaknesses,
              ourAdvantages: battlecardContent.ourAdvantages,
              objections: battlecardContent.objections,
              talkTracks: battlecardContent.talkTracks,
              quickStats: battlecardContent.quickStats,
              lastGeneratedAt: new Date(),
            });
          } else {
            await storage.createBattlecard({
              competitorId: competitor.id,
              tenantDomain,
              marketId: marketId || null,
              createdBy: userId,
              strengths: battlecardContent.strengths,
              weaknesses: battlecardContent.weaknesses,
              ourAdvantages: battlecardContent.ourAdvantages,
              objections: battlecardContent.objections,
              talkTracks: battlecardContent.talkTracks,
              quickStats: battlecardContent.quickStats,
            });
          }
          results.battlecardsGenerated++;
        }
      } catch (e) {
        console.error(`Full regen: Failed to generate battlecard for ${competitor.name}:`, e);
      }
    }

    progress.currentStep = "Generating GTM plan";
    progress.stepsCompleted = 4;

    if (companyProfile) {
      try {
        const openai = new OpenAI({
          apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        });

        let competitorContext = "";
        if (competitors.length > 0) {
          competitorContext = "\n\nCompetitors:";
          for (const c of competitors) {
            competitorContext += `\n- ${c.name} (${c.url})`;
          }
        }

        let analysisContext = "";
        if (gaps.length > 0) {
          analysisContext += "\n\nIdentified Gaps:";
          for (const gap of gaps.slice(0, 5)) {
            analysisContext += `\n- ${gap.area}: ${gap.observation} (Impact: ${gap.impact})`;
          }
        }

        const gtmPrompt = `You are an expert go-to-market strategist. Create a comprehensive GTM plan in markdown format.

Company: ${companyProfile.companyName}
Website: ${companyProfile.websiteUrl}
Description: ${companyProfile.description || "N/A"}
${competitorContext}
${analysisContext}

Create a detailed, actionable Go-To-Market plan with the following sections:

# Go-To-Market Plan: ${companyProfile.companyName}

## Executive Summary
Brief overview of the GTM strategy

## Target Market Analysis
- Primary target segments
- Market size and opportunity
- Key buyer personas

## Value Proposition
- Core differentiation
- Key benefits by persona
- Competitive advantages

## Positioning Strategy
- Market positioning statement
- Category definition
- Competitive differentiation

## Channel Strategy
- Primary distribution channels
- Partner ecosystem opportunities
- Digital presence optimization

## Marketing Strategy
- Content marketing approach
- Demand generation tactics
- Brand awareness initiatives

## Sales Strategy
- Sales motion (product-led, sales-led, hybrid)
- Sales process and stages
- Key objection handling

## Launch Plan
- Phase 1: Foundation (30 days)
- Phase 2: Growth (60 days)
- Phase 3: Scale (90 days)

## Success Metrics
- Key performance indicators
- Revenue targets
- Customer acquisition goals

## Resource Requirements
- Team structure
- Budget considerations
- Technology stack

Make this practical and actionable for the team.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-5.2",
          max_completion_tokens: 4096,
          messages: [{ role: "user", content: gtmPrompt }],
        });

        const gtmContent = completion.choices[0]?.message?.content || "";
        
        const existingGtm = await storage.getLongFormRecommendationByType("gtm_plan", undefined, companyProfile.id);
        if (existingGtm) {
          await storage.updateLongFormRecommendation(existingGtm.id, {
            content: gtmContent,
            status: "generated",
            lastGeneratedAt: new Date(),
            generatedBy: userId,
          });
        } else {
          await storage.createLongFormRecommendation({
            type: "gtm_plan",
            companyProfileId: companyProfile.id,
            tenantDomain,
            marketId: marketId || null,
            content: gtmContent,
            status: "generated",
            generatedBy: userId,
          });
        }
        results.gtmPlanGenerated = true;
      } catch (e) {
        console.error("Full regen: Failed to generate GTM plan:", e);
      }
    }

    progress.currentStep = "Generating messaging framework";
    progress.stepsCompleted = 5;

    if (companyProfile) {
      try {
        const messagingPrompt = `You are an expert marketing strategist. Create a comprehensive messaging framework in markdown format.

Company: ${companyProfile.companyName}
Website: ${companyProfile.websiteUrl}
Description: ${companyProfile.description || "N/A"}

Create a messaging framework with these sections:

# Messaging Framework: ${companyProfile.companyName}

## Brand Positioning Statement
Core positioning that differentiates in the market

## Value Propositions
### Primary Value Proposition
### Secondary Value Propositions

## Key Messages by Audience
### C-Suite / Executives
### Technical Decision Makers
### End Users / Practitioners

## Elevator Pitch
30-second and 60-second versions

## Tagline Options
3-5 tagline options

## Proof Points
Evidence and social proof

## Competitive Differentiators
What sets us apart

## Brand Voice & Tone
Guidelines for consistent messaging

Make this practical and ready to use in marketing materials.`;

        const anthropic = new Anthropic({
          apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
        });

        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 4096,
          messages: [{ role: "user", content: messagingPrompt }],
        });

        const messagingContent = message.content[0].type === "text" ? message.content[0].text : "";
        
        const existingMessaging = await storage.getLongFormRecommendationByType("messaging_framework", undefined, companyProfile.id);
        if (existingMessaging) {
          await storage.updateLongFormRecommendation(existingMessaging.id, {
            content: messagingContent,
            status: "generated",
            lastGeneratedAt: new Date(),
            generatedBy: userId,
          });
        } else {
          await storage.createLongFormRecommendation({
            type: "messaging_framework",
            companyProfileId: companyProfile.id,
            tenantDomain,
            marketId: marketId || null,
            content: messagingContent,
            status: "generated",
            generatedBy: userId,
          });
        }
        results.messagingFrameworkGenerated = true;
      } catch (e) {
        console.error("Full regen: Failed to generate messaging framework:", e);
      }
    }

    // Step 7: Generate marketing tasks for existing marketing plans
    progress.currentStep = "Generating marketing tasks";
    progress.stepsCompleted = 6;

    try {
      const marketingCtx = { tenantDomain, marketId: marketId || null };
      const marketingPlans = await storage.getMarketingPlans(marketingCtx);
      if (marketingPlans.length > 0 && companyProfile) {
        const anthropicForTasks = new Anthropic({
          apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
        });

        const categoryLabels: Record<string, string> = {
          events: "Events & Trade Shows",
          digital_marketing: "Digital Marketing",
          outbound_campaigns: "Outbound Campaigns",
          content_marketing: "Content Marketing",
          social_media: "Social Media",
          email_marketing: "Email Marketing",
          seo_sem: "SEO/SEM",
          pr_comms: "PR & Communications",
          analyst_relations: "Analyst Relations",
          partner_marketing: "Partner Marketing",
          customer_marketing: "Customer Marketing",
          product_marketing: "Product Marketing",
          brand: "Brand",
          website: "Website",
          webinars: "Webinars",
          podcasts: "Podcasts",
          video: "Video",
          research: "Research & Insights",
          other: "Other",
        };

        const periodLabels: Record<string, string> = {
          steady_state: "Steady State (Ongoing)",
          Q1: "Q1", Q2: "Q2", Q3: "Q3", Q4: "Q4",
          future: "Future",
          q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4",
          h1: "H1 (First Half)", h2: "H2 (Second Half)",
          annual: "Full Year",
        };

        let gtmPlan: any = null;
        gtmPlan = await storage.getLongFormRecommendationByType("gtm_plan", undefined, companyProfile.id);

        const recommendations = await storage.getRecommendationsByContext(contextFilter);

        for (const mPlan of marketingPlans) {
          try {
            const configMatrix = mPlan.configMatrix as any;
            if (!configMatrix?.categories?.length || !configMatrix?.periods?.length) {
              console.log(`Full regen: Skipping marketing plan "${mPlan.name}" - no categories/periods configured`);
              continue;
            }

            const categories: string[] = configMatrix.categories;
            const periods: string[] = configMatrix.periods;

            const existingTasks = await storage.getMarketingTasks(mPlan.id, marketingCtx);

            const selectedCategoryNames = categories.map((c: string) => categoryLabels[c] || c);
            const selectedPeriodNames = periods.map((p: string) => periodLabels[p] || p);

            const companyName = companyProfile.companyName || companyProfile.websiteUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') || "Unknown";
            let contextInfo = `Company: ${companyName}\n`;
            if (companyProfile.description) {
              contextInfo += `Description: ${companyProfile.description}\n`;
            }
            if (competitors.length > 0) {
              contextInfo += `Key Competitors: ${competitors.slice(0, 5).map((c: any) => c.name).join(", ")}\n`;
            }

            let gtmPlanContext = "";
            if (gtmPlan?.content && gtmPlan.status === "generated") {
              const truncatedGtm = gtmPlan.content.length > 3000
                ? gtmPlan.content.substring(0, 3000) + "..."
                : gtmPlan.content;
              gtmPlanContext = `\n## Draft GTM Plan (Key Strategic Input)\n${truncatedGtm}\n`;
            }

            let recommendationsContext = "";
            const activeRecs = recommendations.filter((r: any) => r.status !== "dismissed").slice(0, 10);
            if (activeRecs.length > 0) {
              recommendationsContext = `\n## Strategic Recommendations\n`;
              activeRecs.forEach((r: any) => {
                recommendationsContext += `- [${r.area}] ${r.title}: ${r.description?.substring(0, 150) || ""}...\n`;
              });
            }

            let existingTasksContext = "";
            if (existingTasks.length > 0) {
              existingTasksContext = `\n## EXISTING TASKS (DO NOT DUPLICATE)\n`;
              existingTasks.forEach((t: any) => {
                existingTasksContext += `- [${categoryLabels[t.activityGroup] || t.activityGroup}] "${t.title}"\n`;
              });
              existingTasksContext += `\nGenerate only NEW, unique tasks that are different from the above.\n`;
            }

            const prompt = `Generate marketing tasks for a ${mPlan.fiscalYear} marketing plan.

## Company Context
${contextInfo}
${gtmPlanContext}
${recommendationsContext}
${existingTasksContext}

## Task Generation Request
Selected Activity Categories: ${selectedCategoryNames.join(", ")}
Time Periods: ${selectedPeriodNames.join(", ")}

Generate 2-3 specific, actionable marketing tasks for EACH selected category. Each task should:
1. Be specific and measurable
2. DIRECTLY ALIGN with the Draft GTM Plan strategies and recommendations above
3. Address competitive gaps or opportunities identified in the strategic recommendations
4. Include a suggested priority (High, Medium, or Low)
5. Be assigned to one of the selected time periods (use "steady_state" for ongoing activities)
6. BE UNIQUE - DO NOT duplicate any existing tasks listed above

Respond in JSON format:
{
  "tasks": [
    {
      "title": "Task title",
      "description": "Brief description of the task and how it supports the GTM strategy",
      "activityGroup": "category_value",
      "priority": "High|Medium|Low",
      "timeframe": "period_value"
    }
  ]
}

Only use these activityGroup values: ${categories.join(", ")}
Only use these timeframe values: ${periods.join(", ")}`;

            const message = await anthropicForTasks.messages.create({
              model: "claude-sonnet-4-5",
              max_tokens: 8000,
              messages: [{ role: "user", content: prompt }],
              system: "You are a marketing strategy expert. Generate practical, actionable marketing tasks based on the company's competitive landscape. Always respond with valid JSON only, no additional text.",
            });

            const aiResponse = message.content[0].type === "text" ? message.content[0].text : "";

            let cleanedResponse = aiResponse.trim();
            if (cleanedResponse.startsWith("```json")) cleanedResponse = cleanedResponse.slice(7);
            else if (cleanedResponse.startsWith("```")) cleanedResponse = cleanedResponse.slice(3);
            if (cleanedResponse.endsWith("```")) cleanedResponse = cleanedResponse.slice(0, -3);
            cleanedResponse = cleanedResponse.trim();

            let generatedTasks: any[] = [];
            try {
              if (cleanedResponse.startsWith("{")) {
                const parsed = JSON.parse(cleanedResponse);
                generatedTasks = parsed.tasks || [];
              } else if (cleanedResponse.startsWith("[")) {
                generatedTasks = JSON.parse(cleanedResponse);
              }
            } catch {
              try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*"tasks"\s*:\s*\[([\s\S]*)\]\s*\}/);
                if (jsonMatch) {
                  const parsed = JSON.parse(jsonMatch[0]);
                  generatedTasks = parsed.tasks || [];
                }
              } catch {
                console.error(`Full regen: Failed to parse AI marketing tasks for plan "${mPlan.name}"`);
              }
            }

            for (const task of generatedTasks) {
              if (!task.title || !task.activityGroup || !task.timeframe) continue;
              if (!categories.includes(task.activityGroup)) continue;
              if (!periods.includes(task.timeframe)) continue;

              const created = await storage.createMarketingTask({
                planId: mPlan.id,
                title: task.title,
                description: task.description || null,
                activityGroup: task.activityGroup,
                timeframe: task.timeframe,
                priority: task.priority || "Medium",
                status: "suggested",
                aiGenerated: true,
                sourceRecommendationId: null,
              }, marketingCtx);
              if (created) {
                results.marketingTasksGenerated++;
              }
            }

            console.log(`Full regen: Generated ${generatedTasks.length} marketing tasks for plan "${mPlan.name}"`);
          } catch (planError) {
            console.error(`Full regen: Failed to generate tasks for marketing plan "${mPlan.name}":`, planError);
          }
        }
      }
    } catch (marketingError) {
      console.error("Full regen: Failed to generate marketing tasks:", marketingError);
    }

    progress.currentStep = "Recording scores";
    progress.stepsCompleted = 7;

    try {
      const { calculateBaselineScore, calculateScores, getCurrentWeeklyPeriod } = await import("./scoring-service");
      const period = getCurrentWeeklyPeriod();
      
      // Record baseline score history
      if (companyProfile) {
        const baselineScore = calculateBaselineScore({
          description: companyProfile.description,
          crawlData: companyProfile.crawlData as any,
          blogSnapshot: companyProfile.blogSnapshot as any,
          linkedInEngagement: companyProfile.linkedInEngagement as any,
          instagramEngagement: companyProfile.instagramEngagement as any,
          lastCrawl: companyProfile.lastCrawl,
        });
        
        // Check if already recorded this period
        const existingHistory = await storage.getScoreHistory("baseline", companyProfile.id, 1);
        if (!existingHistory.length || existingHistory[0].period !== period) {
          await storage.createScoreHistory({
            entityType: "baseline",
            entityId: companyProfile.id,
            entityName: companyProfile.companyName,
            tenantDomain,
            marketId: marketId || companyProfile.marketId || undefined,
            overallScore: Math.round(baselineScore.overallScore),
            innovationScore: Math.round(baselineScore.innovationScore),
            marketPresenceScore: Math.round(baselineScore.marketPresenceScore),
            contentActivityScore: Math.round(baselineScore.contentActivityScore),
            socialEngagementScore: Math.round(baselineScore.socialEngagementScore),
            scoreBreakdown: baselineScore,
            period,
          });
          console.log(`Full regen: Recorded baseline score history for ${companyProfile.companyName}`);
        }
      }
      
      // Record competitor score history
      for (const competitor of competitors) {
        const competitorScores = calculateScores(
          competitor.analysisData as any,
          competitor.linkedInEngagement as any,
          competitor.instagramEngagement as any,
          competitor.crawlData as any,
          competitor.blogSnapshot as any,
          competitor.lastCrawl
        );
        
        const existingHistory = await storage.getScoreHistory("competitor", competitor.id, 1);
        if (!existingHistory.length || existingHistory[0].period !== period) {
          await storage.createScoreHistory({
            entityType: "competitor",
            entityId: competitor.id,
            entityName: competitor.name,
            tenantDomain,
            marketId: marketId || competitor.marketId || undefined,
            overallScore: Math.round(competitorScores.overallScore),
            innovationScore: Math.round(competitorScores.innovationScore),
            marketPresenceScore: Math.round(competitorScores.marketPresenceScore),
            contentActivityScore: Math.round(competitorScores.contentActivityScore),
            socialEngagementScore: Math.round(competitorScores.socialEngagementScore),
            scoreBreakdown: competitorScores,
            period,
          });
        }
      }
      console.log(`Full regen: Recorded score history for ${competitors.length} competitors`);
    } catch (scoreError) {
      console.error("Full regen: Failed to record score history:", scoreError);
    }
    
    progress.currentStep = "Generating product summaries";
    progress.stepsCompleted = 8;
    
    try {
      const allProducts = await storage.getProductsByContext(contextFilter);
      if (allProducts.length > 0) {
        const anthropic = new Anthropic({
          apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
        });

        let competitorSummaryContext = "";
        for (const c of competitors.slice(0, 5)) {
          const analysis = c.analysisData as any;
          competitorSummaryContext += `\n- ${c.name}: ${analysis?.summary || "No details"}`;
        }

        for (const product of allProducts) {
          try {
            const productAnalysis = product.analysisData as any;
            const features = await storage.getProductFeaturesByProduct(product.id);
            const featureList = features.slice(0, 10).map(f => f.name).join(", ");

            const prompt = `Write a concise 2-3 sentence competitive position summary for this product.

Product: ${product.name}
Company: ${product.companyName || companyProfile?.companyName || "Unknown"}
Description: ${product.description || "N/A"}
${productAnalysis?.summary ? `Analysis: ${productAnalysis.summary}` : ""}
${featureList ? `Key Features: ${featureList}` : ""}
${product.isBaseline ? "This is the user's own product." : `This is a competitor product from ${product.companyName || "an unknown company"}.`}

Competitive Landscape:${competitorSummaryContext || " No competitor data available."}

Write 2-3 sentences that capture what this product does, its key differentiators, and how it compares to alternatives. Be specific and analytical. Return ONLY the summary text.`;

            const message = await anthropic.messages.create({
              model: "claude-sonnet-4-5",
              max_tokens: 300,
              messages: [{ role: "user", content: prompt }],
            });

            const content = message.content[0];
            if (content.type === "text") {
              await storage.updateProduct(product.id, {
                competitivePositionSummary: content.text.trim(),
                summaryGeneratedAt: new Date(),
              });
            }
          } catch (e) {
            console.error(`Full regen: Failed to generate summary for product ${product.name}:`, e);
          }
        }
        console.log(`Full regen: Generated competitive position summaries for ${allProducts.length} products`);
      }
    } catch (productSummaryError) {
      console.error("Full regen: Failed to generate product summaries:", productSummaryError);
    }

    progress.currentStep = "Complete";
    progress.stepsCompleted = 9;
    progress.status = "completed";
    progress.completedAt = new Date();

    await sendCompletionEmail(userEmail, userName, companyProfile?.companyName || tenantDomain, results);

  } catch (error: any) {
    console.error("Full regeneration failed:", error);
    progress.status = "failed";
    progress.error = error.message;
    progress.completedAt = new Date();
    
    await sendFailureEmail(userEmail, userName, error.message);
  }

  setTimeout(() => activeJobs.delete(jobId), 24 * 60 * 60 * 1000);
}

async function sendCompletionEmail(
  email: string,
  name: string,
  companyName: string,
  results: {
    competitorsAnalyzed: number;
    battlecardsGenerated: number;
    gapsIdentified: number;
    recommendationsGenerated: number;
    gtmPlanGenerated: boolean;
    messagingFrameworkGenerated: boolean;
    marketingTasksGenerated: number;
  }
): Promise<void> {
  const content = `
    <h1>Your Full Analysis is Ready!</h1>
    
    <p>Hi <span class="highlight">${name}</span>,</p>
    
    <p>Great news! Your comprehensive competitive analysis for <span class="highlight">${companyName}</span> has been completed.</p>
    
    <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">Here's what was generated:</p>
    
    <div class="feature-list">
      <div class="feature">
        <div class="feature-title">${results.competitorsAnalyzed} Competitors Analyzed</div>
        <p class="feature-desc">Fresh analysis of competitor websites and positioning.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">${results.battlecardsGenerated} Battlecards Created</div>
        <p class="feature-desc">Sales battlecards with strengths, weaknesses, and talk tracks.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">${results.gapsIdentified} Gaps Identified</div>
        <p class="feature-desc">Market and messaging gaps with actionable insights.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">${results.recommendationsGenerated} Recommendations</div>
        <p class="feature-desc">Strategic recommendations to improve your positioning.</p>
      </div>
      
      ${results.gtmPlanGenerated ? `
      <div class="feature">
        <div class="feature-title">GTM Plan Generated</div>
        <p class="feature-desc">Comprehensive go-to-market strategy using GPT-5.2.</p>
      </div>
      ` : ''}
      
      ${results.messagingFrameworkGenerated ? `
      <div class="feature">
        <div class="feature-title">Messaging Framework Created</div>
        <p class="feature-desc">Complete messaging guide for your marketing team.</p>
      </div>
      ` : ''}
      
      ${results.marketingTasksGenerated > 0 ? `
      <div class="feature">
        <div class="feature-title">${results.marketingTasksGenerated} Marketing Tasks Generated</div>
        <p class="feature-desc">AI-generated marketing tasks for your existing marketing plans.</p>
      </div>
      ` : ''}
    </div>
    
    <div class="button-container">
      <a href="${process.env.REPLIT_DEV_DOMAIN ? 'https://' + process.env.REPLIT_DEV_DOMAIN : ''}/analysis" class="button">View Your Analysis</a>
    </div>
    
    <p class="muted" style="margin-top: 32px;">Your Full Report is now available with all analysis sections, ready for PDF export.</p>
  `;

  const htmlContent = wrapEmailContent(content);
  
  await sendEmail({
    to: email,
    subject: `Your ${companyName} Analysis is Ready - Orbit`,
    html: htmlContent,
  });
}

async function sendFailureEmail(email: string, name: string, errorMessage: string): Promise<void> {
  const content = `
    <h1>Analysis Generation Issue</h1>
    
    <p>Hi <span class="highlight">${name}</span>,</p>
    
    <p>We encountered an issue while generating your comprehensive analysis. Our team has been notified and is looking into it.</p>
    
    <p style="color: #9CA3AF; margin-top: 20px;">Error details: ${errorMessage}</p>
    
    <p>You can try running the analysis again, or contact support if the issue persists.</p>
    
    <div class="button-container">
      <a href="${process.env.REPLIT_DEV_DOMAIN ? 'https://' + process.env.REPLIT_DEV_DOMAIN : ''}/analysis" class="button">Return to Analysis</a>
    </div>
  `;

  const htmlContent = wrapEmailContent(content);
  
  await sendEmail({
    to: email,
    subject: "Analysis Generation Issue - Orbit",
    html: htmlContent,
  });
}
