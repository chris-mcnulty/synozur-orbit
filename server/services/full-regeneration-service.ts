import { storage } from "../storage";
import { analyzeCompetitorWebsite, generateGapAnalysis, generateRecommendations, type CompetitorAnalysis } from "../ai-service";
import { sendEmail, wrapEmailContent } from "./email-service";
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
  userName: string
): Promise<string> {
  const jobId = `regen_${tenantDomain}_${Date.now()}`;
  
  const progress: RegenerationProgress = {
    status: "pending",
    currentStep: "Initializing",
    stepsCompleted: 0,
    totalSteps: 6,
    startedAt: new Date(),
  };
  
  activeJobs.set(jobId, progress);
  
  runRegenerationInBackground(jobId, userId, tenantDomain, userEmail, userName);
  
  return jobId;
}

async function runRegenerationInBackground(
  jobId: string,
  userId: string,
  tenantDomain: string,
  userEmail: string,
  userName: string
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
  } = {
    competitorsAnalyzed: 0,
    battlecardsGenerated: 0,
    gapsIdentified: 0,
    recommendationsGenerated: 0,
    gtmPlanGenerated: false,
    messagingFrameworkGenerated: false,
  };

  try {
    const user = await storage.getUser(userId);
    if (!user) throw new Error("User not found");

    const companyProfile = await storage.getCompanyProfileByTenant(tenantDomain);
    const competitors = await storage.getCompetitorsByTenantDomain(tenantDomain);
    const groundingDocs = await storage.getGroundingDocumentsByTenant(tenantDomain);
    const groundingContext = groundingDocs
      .filter(doc => doc.extractedText)
      .map(doc => doc.extractedText)
      .join("\n\n");

    progress.currentStep = "Analyzing competitors";
    progress.stepsCompleted = 1;

    let ourPositioning = companyProfile 
      ? `${companyProfile.companyName}: ${companyProfile.description || 'No description provided'}`
      : "Our company positioning";
    
    if (groundingContext) {
      ourPositioning += `\n\nAdditional context from positioning documents:\n${groundingContext.slice(0, 5000)}`;
    }

    const analyses: any[] = [];
    for (const competitor of competitors.slice(0, 10)) {
      try {
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
          const analysis = await analyzeCompetitorWebsite(
            competitor.name,
            competitor.url,
            content
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

    const recommendations = await generateRecommendations(gaps, analyses);
    results.recommendationsGenerated = recommendations.length;

    for (const rec of recommendations) {
      await storage.createRecommendation({
        title: rec.title,
        description: rec.description,
        area: rec.area,
        impact: rec.impact,
        userId: userId,
        tenantDomain,
      });
    }

    const ourAnalysisData = companyProfile?.analysisData as any;
    const ourSummary = ourAnalysisData?.summary || companyProfile?.description || "Our positioning";
    const ourKeyMessages = ourAnalysisData?.keyMessages || [];

    await storage.createAnalysis({
      userId: userId,
      tenantDomain,
      themes: analyses.map(a => ({
        theme: a.valueProposition,
        us: companyProfile ? "Based on profile" : "Medium",
        competitorA: "High",
        competitorB: "Medium",
      })),
      messaging: analyses.slice(0, 3).map((a, i) => ({
        category: a.targetAudience || "Market Positioning",
        us: ourKeyMessages[i] || ourSummary,
        competitorA: a.keyMessages[0] || "",
        competitorB: a.keyMessages[1] || "",
      })),
      gaps: gaps,
    });

    progress.currentStep = "Generating battlecards";
    progress.stepsCompleted = 3;

    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });

    for (const competitor of competitors.slice(0, 5)) {
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

    progress.currentStep = "Complete";
    progress.stepsCompleted = 6;
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
