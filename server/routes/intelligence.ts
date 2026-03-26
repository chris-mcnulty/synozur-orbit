import type { Express } from "express";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import { toContextFilter, validateResourceContext, logAiUsage, computeLatestSourceDataTimestamp } from "./helpers";
import { checkFeatureAccessAsync } from "../services/plan-policy";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { formatPersonaContextForPrompt } from "../services/strategic-context";
import { hasCrossTenantReadAccess } from "./helpers";

export function registerIntelligenceRoutes(app: Express) {
  // =====================================================
  // Long-form Recommendation Endpoints (GTM, Messaging)
  // =====================================================
  
  // Get all long-form recommendations for a project
  app.get("/api/projects/:projectId/recommendations", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const recommendations = await storage.getLongFormRecommendationsByProject(req.params.projectId);
      res.json(recommendations);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific recommendation by type for a project
  app.get("/api/projects/:projectId/recommendations/:type", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const recommendation = await storage.getLongFormRecommendationByType(
        req.params.type,
        req.params.projectId
      );
      
      if (!recommendation) {
        // Return a placeholder if not generated yet
        return res.json({
          type: req.params.type,
          projectId: req.params.projectId,
          status: "not_generated",
          content: null,
          savedPrompts: null,
          lastGeneratedAt: null
        });
      }
      
      res.json(recommendation);
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Generate GTM plan for a project
  app.post("/api/projects/:projectId/recommendations/gtm_plan/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Extract prompts from request body
      const { targetRoles, distributionChannels, customGuidance, budget, timeline } = req.body;
      const savedPrompts = { targetRoles, distributionChannels, customGuidance, budget, timeline };

      // Get project products for context
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      // Load personas for context
      const tenantPersonas = await storage.getPersonasByContext({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId });
      const personaContext = tenantPersonas.length > 0 ? formatPersonaContextForPrompt(tenantPersonas) : "";

      // Build context for AI
      let productContext = "";
      if (baselineProduct) {
        productContext += `\n\nOur Product: ${baselineProduct.product.name}\nDescription: ${baselineProduct.product.description || "N/A"}\nCompany: ${baselineProduct.product.companyName || "N/A"}`;
      }
      if (competitorProducts.length > 0) {
        productContext += "\n\nCompetitors:";
        for (const cp of competitorProducts) {
          productContext += `\n- ${cp.product.name} (${cp.product.companyName || "Unknown"})`;
        }
      }

      const prompt = `You are an expert go-to-market strategist. Create a comprehensive Go-To-Market Plan in markdown format for the following project.

Project: ${project.name}
Client: ${project.clientName}
${productContext}
${personaContext ? `\n${personaContext}\n` : ""}
User Guidance:
- Target Roles/Personas: ${targetRoles || "Not specified - use the buyer personas above if available, otherwise suggest appropriate targets"}
- Distribution Channels: ${distributionChannels || "Not specified - recommend optimal channels based on persona preferred channels if available"}
- Custom Guidance: ${customGuidance || "None"}
- Budget Considerations: ${budget || "Not specified"}
- Timeline: ${timeline || "Not specified"}

Create a detailed, actionable GTM plan with the following sections:

# Go-To-Market Plan: ${project.clientName}

## Executive Summary
Brief overview of the GTM strategy

## Target Market & Buyer Personas
Define ideal customer profiles, decision-makers, and influencers

## Value Proposition & Positioning
Core messaging and differentiation from competitors

## Distribution Strategy
${distributionChannels ? `Focus on: ${distributionChannels}` : "Recommend: Direct sales, Digital marketing, Channel partnerships"}

## Marketing Tactics
- Content marketing
- Demand generation
- Campaigns and initiatives

## Sales Enablement
- Sales playbook highlights
- Objection handling
- Competitive positioning

## Launch Timeline & Milestones
Phased approach with key dates

## Success Metrics & KPIs
How to measure success

## Budget Recommendations
Resource allocation suggestions

## Risks & Mitigation
Potential challenges and solutions

Make this practical and actionable. Use bullet points and clear formatting.`;

      // Use OpenAI gpt-5.2 for enhanced GTM plan generation
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const content = completion.choices[0]?.message?.content || "";

      // Check if recommendation already exists
      const existing = await storage.getLongFormRecommendationByType("gtm_plan", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: req.session.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "gtm_plan",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          savedPrompts,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("GTM plan generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate messaging framework for a project
  app.post("/api/projects/:projectId/recommendations/messaging_framework/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Extract prompts from request body
      const { targetAudience, toneOfVoice, keyMessages, customGuidance } = req.body;
      const savedPrompts = { targetAudience, toneOfVoice, keyMessages, customGuidance };

      // Get project products for context
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      // Load personas for context
      const tenantPersonas = await storage.getPersonasByContext({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId });
      const personaContext = tenantPersonas.length > 0 ? formatPersonaContextForPrompt(tenantPersonas) : "";

      let productContext = "";
      if (baselineProduct) {
        productContext += `\n\nOur Product: ${baselineProduct.product.name}\nDescription: ${baselineProduct.product.description || "N/A"}\nCompany: ${baselineProduct.product.companyName || "N/A"}`;
      }
      if (competitorProducts.length > 0) {
        productContext += "\n\nCompetitors:";
        for (const cp of competitorProducts) {
          productContext += `\n- ${cp.product.name} (${cp.product.companyName || "Unknown"})`;
        }
      }

      const prompt = `You are an expert brand strategist and messaging architect. Create a comprehensive Messaging & Positioning Framework in markdown format.

Project: ${project.name}
Client: ${project.clientName}
${productContext}
${personaContext ? `\n${personaContext}\n` : ""}
User Guidance:
- Target Audience: ${targetAudience || "Not specified - use the buyer personas above if available, otherwise identify appropriate audiences"}
- Tone of Voice: ${toneOfVoice || "Not specified - recommend appropriate tone based on persona preferences if available"}
- Key Messages to Emphasize: ${keyMessages || "Not specified"}
- Custom Guidance: ${customGuidance || "None"}

Create a detailed messaging framework with the following sections:

# Messaging & Positioning Framework: ${project.clientName}

## Brand Positioning Statement
A clear, concise positioning statement following the format:
"For [target audience] who [need], [product/brand] is the [category] that [key benefit] because [reason to believe]."

## Core Value Proposition
The primary value we deliver to customers

## Messaging Pillars
3-5 key themes that support the positioning

## Audience Segments & Tailored Messages
For each key audience:
- Who they are
- Their pain points
- Key messages that resonate
- Proof points

## Competitive Differentiation
How we stand apart from competitors

## Tone of Voice Guidelines
- Personality traits
- Do's and Don'ts
- Example phrases

## Key Talking Points
Elevator pitches of varying lengths:
- 10-second version
- 30-second version
- 2-minute version

## Tagline Options
3-5 potential taglines

## Proof Points & Evidence
Statistics, case studies, testimonials to support claims

## Messaging Do's and Don'ts
Clear guidelines on messaging boundaries

Make this practical and ready for use by sales, marketing, and leadership teams.`;

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      // Log AI usage
      await logAiUsage(ctx, "generate_messaging_framework", "anthropic", "claude-sonnet-4-5", message.usage);

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      // Check if recommendation already exists
      const existing = await storage.getLongFormRecommendationByType("messaging_framework", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "messaging_framework",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          savedPrompts,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Messaging framework generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate product one sheet (marketing copy draft)
  app.post("/api/projects/:projectId/recommendations/product_one_sheet/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { targetAudience, keyBenefits, toneOfVoice, customGuidance } = req.body;
      const savedPrompts = { targetAudience, keyBenefits, toneOfVoice, customGuidance };

      // Get product context
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set. Please add a baseline product first." });
      }

      // Load personas for context
      const tenantPersonas = await storage.getPersonasByContext({ tenantDomain: ctx.tenantDomain, marketId: ctx.marketId });
      const personaContext = tenantPersonas.length > 0 ? formatPersonaContextForPrompt(tenantPersonas) : "";

      // Get product features for context
      const features = await storage.getProductFeaturesByProduct(baselineProduct.productId);
      const releasedFeatures = features.filter((f: { status: string }) => f.status === "released");

      // Get battlecards for competitive differentiation
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      let productContext = `
Product: ${baselineProduct.product.name}
Company: ${baselineProduct.product.companyName || project.clientName}
Description: ${baselineProduct.product.description || "N/A"}
URL: ${baselineProduct.product.url || "N/A"}`;

      if (releasedFeatures.length > 0) {
        productContext += `\n\nKey Features:\n${releasedFeatures.slice(0, 10).map((f: { name: string; description: string | null }) => `- ${f.name}: ${f.description || ""}`).join("\n")}`;
      }

      let competitiveContext = "";
      if (competitorProducts.length > 0) {
        competitiveContext = "\n\nCompetitors:";
        for (const cp of competitorProducts) {
          competitiveContext += `\n- ${cp.product.name} (${cp.product.companyName || "Unknown"})`;
        }
      }

      if (battlecards.length > 0) {
        const bc = battlecards[0];
        const advantages = bc.ourAdvantages as string[] | null;
        const differentiators = bc.keyDifferentiators as { feature: string; ours: string; theirs: string }[] | null;
        if (advantages?.length) {
          competitiveContext += `\n\nOur Key Advantages:\n${advantages.slice(0, 5).map((a: string) => `- ${a}`).join("\n")}`;
        }
        if (differentiators?.length) {
          competitiveContext += `\n\nKey Differentiators:\n${differentiators.slice(0, 5).map((d: { feature: string; ours: string }) => `- ${d.feature}: ${d.ours}`).join("\n")}`;
        }
      }

      const prompt = `You are an expert product marketing copywriter. Create a compelling Product One Sheet (single-page marketing document) in markdown format.

${productContext}
${competitiveContext}
${personaContext ? `\n${personaContext}\n` : ""}
User Guidance:
- Target Audience: ${targetAudience || "Not specified - use the buyer personas above if available, otherwise suggest appropriate audience"}
- Key Benefits to Highlight: ${keyBenefits || "Not specified - identify top benefits that address persona pain points if available"}
- Tone of Voice: ${toneOfVoice || "Professional and compelling"}
- Custom Guidance: ${customGuidance || "None"}

Create a complete Product One Sheet with the following structure:

# ${baselineProduct.product.name}

## Headline
A compelling tagline (8-12 words max)

## The Challenge
2-3 sentences describing the problem your audience faces

## The Solution
2-3 sentences describing how this product solves that problem

## Key Benefits
- Benefit 1 with specific value proposition
- Benefit 2 with specific value proposition  
- Benefit 3 with specific value proposition
(3-5 bullet points, each with a clear business outcome)

## Key Features
- Feature 1: Brief description
- Feature 2: Brief description
- Feature 3: Brief description
(Top 3-5 features with concise descriptions)

## Why Choose ${baselineProduct.product.companyName || "Us"}
3-4 sentences on competitive differentiation and credibility

## Call to Action
Clear next step for the reader

---

Make this compelling, concise, and suitable for a one-page PDF. Use active voice and focus on customer outcomes over features.`;

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      await logAiUsage(ctx, "generate_product_one_sheet", "anthropic", "claude-sonnet-4-5", message.usage);

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("product_one_sheet", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          savedPrompts,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "product_one_sheet",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          savedPrompts,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Product one sheet generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate project-level gap analysis
  app.post("/api/projects/:projectId/recommendations/gap_analysis/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set" });
      }

      const baseline = await storage.getProduct(baselineProduct.productId);
      const competitors = await Promise.all(
        competitorProducts.map(pp => storage.getProduct(pp.productId))
      );

      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const prompt = `You are a competitive intelligence analyst. Analyze the positioning gaps for "${baseline?.name}" compared to its competitors.

## Our Product
Name: ${baseline?.name}
Company: ${baseline?.companyName || "Unknown"}
Description: ${baseline?.description || "No description"}

## Competitors
${competitors.filter(Boolean).map(c => `- ${c?.name} (${c?.companyName || "Unknown"}): ${c?.description || "No description"}`).join("\n")}

## Battlecard Insights
${battlecards.map(bc => `
Competitor: ${competitors.find(c => c?.id === bc.competitorProductId)?.name || "Unknown"}
- Their Strengths: ${(Array.isArray(bc.strengths) ? bc.strengths : []).join(", ")}
- Their Weaknesses: ${(Array.isArray(bc.weaknesses) ? bc.weaknesses : []).join(", ")}
- Our Advantages: ${(Array.isArray(bc.ourAdvantages) ? bc.ourAdvantages : []).join(", ")}
`).join("\n")}

Generate a comprehensive gap analysis in markdown format with these sections:

# Gap Analysis: ${baseline?.name}

## Executive Summary
Brief overview of key positioning gaps identified

## Messaging Gaps
Areas where our messaging falls short compared to competitors

## Feature/Capability Gaps
Product features or capabilities where competitors have an edge

## Market Positioning Gaps
Areas where competitors have stronger market positioning

## Pricing/Value Gaps
Competitive pricing and value perception differences

## Target Audience Gaps
Segments where competitors are better positioned

## Critical Gaps (High Priority)
The most urgent gaps that need immediate attention

## Opportunities
Gaps in competitor offerings we can exploit

Make this actionable and specific to the competitive landscape.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      // Log AI usage
      await logAiUsage(ctx, "generate_gap_analysis", "anthropic", "claude-sonnet-4-5", message.usage);

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("gap_analysis", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "gap_analysis",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Gap analysis generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate project-level recommendations
  app.post("/api/projects/:projectId/recommendations/strategic_recommendations/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set" });
      }

      const baseline = await storage.getProduct(baselineProduct.productId);
      const competitors = await Promise.all(
        competitorProducts.map(pp => storage.getProduct(pp.productId))
      );

      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);
      const gapAnalysis = await storage.getLongFormRecommendationByType("gap_analysis", req.params.projectId);

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const prompt = `You are a strategic business consultant. Generate actionable recommendations for "${baseline?.name}" based on its competitive landscape.

## Our Product
Name: ${baseline?.name}
Company: ${baseline?.companyName || "Unknown"}
Description: ${baseline?.description || "No description"}

## Competitors
${competitors.filter(Boolean).map(c => `- ${c?.name} (${c?.companyName || "Unknown"}): ${c?.description || "No description"}`).join("\n")}

## Competitive Intelligence
${battlecards.map(bc => `
vs ${competitors.find(c => c?.id === bc.competitorProductId)?.name || "Unknown"}:
- Their Strengths: ${(Array.isArray(bc.strengths) ? bc.strengths : []).slice(0, 3).join(", ")}
- Our Advantages: ${(Array.isArray(bc.ourAdvantages) ? bc.ourAdvantages : []).slice(0, 3).join(", ")}
`).join("\n")}

${gapAnalysis?.content ? `## Gap Analysis Summary\n${gapAnalysis.content.slice(0, 2000)}` : ""}

Generate strategic recommendations in markdown format:

# Strategic Recommendations: ${baseline?.name}

## Executive Summary
Overview of recommended strategic actions

## Immediate Actions (30 Days)
Quick wins and urgent items to address

## Short-Term Initiatives (90 Days)
Projects to kick off in the next quarter

## Long-Term Strategy (6-12 Months)
Bigger strategic moves to consider

## Messaging Recommendations
How to improve competitive messaging

## Product Recommendations
Feature and capability priorities

## Go-to-Market Recommendations
Sales and marketing strategy adjustments

## Competitive Defense Strategy
How to protect against competitor moves

## Success Metrics
How to measure progress on these recommendations

Make each recommendation specific, actionable, and tied to competitive insights.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("strategic_recommendations", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "strategic_recommendations",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Strategic recommendations generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate project-level competitive summary
  app.post("/api/projects/:projectId/recommendations/competitive_summary/generate", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set" });
      }

      const baseline = await storage.getProduct(baselineProduct.productId);
      const competitors = await Promise.all(
        competitorProducts.map(pp => storage.getProduct(pp.productId))
      );

      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const prompt = `You are a competitive intelligence analyst. Create a comprehensive competitive summary report for "${baseline?.name}".

## Our Product
Name: ${baseline?.name}
Company: ${baseline?.companyName || "Unknown"}
Description: ${baseline?.description || "No description"}

## Competitors Analyzed
${competitors.filter(Boolean).map(c => `- ${c?.name} (${c?.companyName || "Unknown"}): ${c?.description || "No description"}`).join("\n")}

## Battlecard Data
${battlecards.map(bc => {
  const comp = competitors.find(c => c?.id === bc.competitorProductId);
  return `
### ${comp?.name || "Unknown Competitor"}
**Strengths:** ${(Array.isArray(bc.strengths) ? bc.strengths : []).join("; ")}
**Weaknesses:** ${(Array.isArray(bc.weaknesses) ? bc.weaknesses : []).join("; ")}
**Our Advantages:** ${(Array.isArray(bc.ourAdvantages) ? bc.ourAdvantages : []).join("; ")}
**Key Differentiators:** ${(Array.isArray(bc.keyDifferentiators) ? bc.keyDifferentiators : []).map((d: any) => d.feature).join(", ")}
`;
}).join("\n")}

Generate a consolidated competitive summary in markdown format:

# Competitive Landscape Summary: ${baseline?.name}

## Executive Overview
High-level summary of competitive position

## Market Positioning Map
Where each player sits in the market

## Competitor Profiles
For each competitor:
### [Competitor Name]
- **Overview**: Brief description
- **Target Market**: Who they serve
- **Key Strengths**: Top 3 strengths
- **Key Weaknesses**: Top 3 weaknesses  
- **Threat Level**: Low/Medium/High and why
- **Our Win Strategy**: How to beat them

## Competitive Advantages Summary
Our strongest differentiators across all competitors

## Common Competitive Themes
Patterns seen across multiple competitors

## Risk Assessment
Competitive threats to monitor

## Win/Loss Insights
Key factors in competitive deals

## Recommended Actions
Top priorities based on competitive landscape

Make this a comprehensive reference document for sales and strategy teams.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0].type === "text" ? message.content[0].text : "";

      const existing = await storage.getLongFormRecommendationByType("competitive_summary", req.params.projectId);

      if (existing) {
        const updated = await storage.updateLongFormRecommendation(existing.id, {
          content,
          status: "generated",
          lastGeneratedAt: new Date(),
          generatedBy: ctx.userId,
        });
        res.json(updated);
      } else {
        const created = await storage.createLongFormRecommendation({
          type: "competitive_summary",
          projectId: req.params.projectId,
          tenantDomain: ctx.tenantDomain,
          marketId: ctx.marketId,
          content,
          status: "generated",
          generatedBy: ctx.userId,
          lastGeneratedAt: new Date(),
        });
        res.json(created);
      }
    } catch (error: any) {
      if (error instanceof ContextError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Competitive summary generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===============================
  // EXECUTIVE SUMMARY DASHBOARD
  // ===============================

  // Get project executive summary - unified view of all competitive intelligence
  app.get("/api/projects/:projectId/executive-summary", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Validate project belongs to current context
      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Gather all project data
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      // Get competitor scores - first try project-level, then fall back to competitor-level
      let competitorScoresData = await storage.getCompetitorScoresByProject(req.params.projectId);
      
      // If no project-specific scores, fetch by competitorId or productId for each competitor product
      if (competitorScoresData.length === 0) {
        for (const pp of competitorProducts) {
          // Try competitorId first, then fall back to productId (for standalone products)
          const scoreId = pp.product?.competitorId || pp.product?.id;
          if (scoreId) {
            const score = await storage.getCompetitorScore(scoreId);
            if (score) {
              competitorScoresData.push(score);
            }
          }
        }
      }

      // Get all long-form recommendations
      const recommendations = await storage.getLongFormRecommendationsByProject(req.params.projectId);
      const gapAnalysis = recommendations.find(r => r.type === "gap_analysis");
      const strategicRecs = recommendations.find(r => r.type === "strategic_recommendations");
      const competitiveSummary = recommendations.find(r => r.type === "competitive_summary");
      const gtmPlan = recommendations.find(r => r.type === "gtm_plan");
      const messagingFramework = recommendations.find(r => r.type === "messaging_framework");

      // Get battlecards
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      // Calculate overall analytics
      const totalCompetitors = competitorProducts.length;
      const analyzedCompetitors = competitorProducts.filter(pp => pp.product?.analysisData).length;
      const battlecardsGenerated = battlecards.filter(bc => bc.status === "published" || (Array.isArray(bc.strengths) && bc.strengths.length > 0)).length;

      // Compute rankings from scores
      const rankedCompetitors = competitorScoresData.map(score => {
        // Match by competitorId first, then by productId (for standalone products)
        const productInfo = competitorProducts.find(cp => 
          (score.competitorId && cp.product?.competitorId && cp.product.competitorId === score.competitorId) ||
          (score.productId && cp.product?.id === score.productId)
        );
        
        // Use entityName from score if available, otherwise fall back to product info
        const displayName = score.entityName || productInfo?.product?.name || "Unknown";
        const companyName = productInfo?.product?.companyName || score.entityName || "Unknown";
        
        return {
          competitorId: score.competitorId,
          productId: score.productId || productInfo?.productId || null,
          name: displayName,
          companyName: companyName,
          overallScore: score.overallScore,
          trendDirection: score.trendDirection,
          trendDelta: score.trendDelta || 0,
          breakdown: {
            marketPresence: score.marketPresenceScore,
            innovation: score.innovationScore,
            pricing: score.pricingScore,
            featureBreadth: score.featureBreadthScore,
            contentActivity: score.contentActivityScore,
            socialEngagement: score.socialEngagementScore,
          }
        };
      }).sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));

      // Identify rising/falling competitors
      const risingCompetitors = rankedCompetitors.filter(c => c.trendDirection === "rising");
      const fallingCompetitors = rankedCompetitors.filter(c => c.trendDirection === "falling");

      // Build executive summary response
      const executiveSummary = {
        project: {
          id: project.id,
          name: project.name,
          clientName: project.clientName,
          analysisType: project.analysisType,
          status: project.status,
        },
        baseline: baselineProduct ? {
          id: baselineProduct.productId,
          name: baselineProduct.product?.name,
          companyName: baselineProduct.product?.companyName,
          description: baselineProduct.product?.description,
        } : null,
        analytics: {
          totalCompetitors,
          analyzedCompetitors,
          battlecardsGenerated,
          completionPercentage: totalCompetitors > 0 
            ? Math.round((analyzedCompetitors / totalCompetitors) * 100) 
            : 0,
        },
        rankings: {
          topCompetitors: rankedCompetitors.slice(0, 5),
          risingThreats: risingCompetitors.slice(0, 3),
          decliningCompetitors: fallingCompetitors.slice(0, 3),
        },
        insights: {
          gapAnalysis: gapAnalysis ? {
            status: gapAnalysis.status,
            lastGenerated: gapAnalysis.lastGeneratedAt,
            content: gapAnalysis.content,
          } : null,
          strategicRecommendations: strategicRecs ? {
            status: strategicRecs.status,
            lastGenerated: strategicRecs.lastGeneratedAt,
            content: strategicRecs.content,
          } : null,
          competitiveSummary: competitiveSummary ? {
            status: competitiveSummary.status,
            lastGenerated: competitiveSummary.lastGeneratedAt,
            content: competitiveSummary.content,
          } : null,
          gtmPlan: gtmPlan ? {
            status: gtmPlan.status,
            lastGenerated: gtmPlan.lastGeneratedAt,
          } : null,
          messagingFramework: messagingFramework ? {
            status: messagingFramework.status,
            lastGenerated: messagingFramework.lastGeneratedAt,
          } : null,
        },
        competitors: competitorProducts.map(cp => {
          const competitorId = cp.product?.competitorId;
          const productId = cp.product?.id;
          // Match by competitorId first, then by productId (for standalone products)
          const matchedScore = rankedCompetitors.find(r => 
            (competitorId && r.competitorId === competitorId) ||
            (productId && r.competitorId === productId)
          );
          return {
            id: cp.productId,
            competitorId: competitorId,
            name: cp.product?.name,
            companyName: cp.product?.companyName,
            score: matchedScore?.overallScore || null,
            trend: matchedScore?.trendDirection || "stable",
            hasAnalysis: !!cp.product?.analysisData,
            hasBattlecard: battlecards.some(bc => bc.competitorProductId === cp.productId),
          };
        }),
        lastUpdated: new Date().toISOString(),
      };

      res.json(executiveSummary);
    } catch (error: any) {
      console.error("Executive summary error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export project as Markdown report
  app.get("/api/projects/:projectId/export", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Gather all project data
      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");
      const recommendations = await storage.getLongFormRecommendationsByProject(req.params.projectId);
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const gapAnalysis = recommendations.find(r => r.type === "gap_analysis");
      const strategicRecs = recommendations.find(r => r.type === "strategic_recommendations");
      const competitiveSummary = recommendations.find(r => r.type === "competitive_summary");
      const gtmPlan = recommendations.find(r => r.type === "gtm_plan");
      const messagingFramework = recommendations.find(r => r.type === "messaging_framework");

      // Build Markdown report
      let markdown = `# ${project.name} - Competitive Intelligence Report\n\n`;
      markdown += `**Client:** ${project.clientName}\n`;
      markdown += `**Analysis Type:** ${project.analysisType === "product" ? "Product Analysis" : "Company Analysis"}\n`;
      markdown += `**Generated:** ${new Date().toLocaleDateString()}\n\n`;
      markdown += `---\n\n`;

      // Products Overview
      markdown += `## Products Overview\n\n`;
      if (baselineProduct) {
        markdown += `### Baseline Product\n`;
        markdown += `- **${baselineProduct.product?.name || "Unnamed"}** (${baselineProduct.product?.companyName || "Unknown Company"})\n`;
        if (baselineProduct.product?.url) {
          markdown += `  - URL: ${baselineProduct.product.url}\n`;
        }
        markdown += `\n`;
      }

      if (competitorProducts.length > 0) {
        markdown += `### Competitors (${competitorProducts.length})\n`;
        for (const cp of competitorProducts) {
          markdown += `- **${cp.product?.name || "Unnamed"}** (${cp.product?.companyName || "Unknown Company"})\n`;
        }
        markdown += `\n`;
      }

      markdown += `---\n\n`;

      // Gap Analysis
      if (gapAnalysis?.status === "generated" && gapAnalysis.content) {
        markdown += `## Gap Analysis\n\n`;
        markdown += `*Last updated: ${gapAnalysis.lastGeneratedAt ? new Date(gapAnalysis.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += gapAnalysis.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // Strategic Recommendations
      if (strategicRecs?.status === "generated" && strategicRecs.content) {
        markdown += `## Strategic Recommendations\n\n`;
        markdown += `*Last updated: ${strategicRecs.lastGeneratedAt ? new Date(strategicRecs.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += strategicRecs.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // Competitive Summary
      if (competitiveSummary?.status === "generated" && competitiveSummary.content) {
        markdown += `## Competitive Summary\n\n`;
        markdown += `*Last updated: ${competitiveSummary.lastGeneratedAt ? new Date(competitiveSummary.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += competitiveSummary.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // GTM Plan
      if (gtmPlan?.status === "generated" && gtmPlan.content) {
        markdown += `## Go-to-Market Plan\n\n`;
        markdown += `*Last updated: ${gtmPlan.lastGeneratedAt ? new Date(gtmPlan.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += gtmPlan.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // Messaging Framework
      if (messagingFramework?.status === "generated" && messagingFramework.content) {
        markdown += `## Messaging Framework\n\n`;
        markdown += `*Last updated: ${messagingFramework.lastGeneratedAt ? new Date(messagingFramework.lastGeneratedAt).toLocaleDateString() : "N/A"}*\n\n`;
        markdown += messagingFramework.content + `\n\n`;
        markdown += `---\n\n`;
      }

      // Battlecards
      const publishedBattlecards = battlecards.filter(bc => bc.status === "published" || (Array.isArray(bc.strengths) && (bc.strengths as string[]).length > 0));
      if (publishedBattlecards.length > 0) {
        markdown += `## Battlecards\n\n`;
        for (const bc of publishedBattlecards) {
          const competitor = competitorProducts.find(cp => cp.productId === bc.competitorProductId);
          markdown += `### ${competitor?.product?.name || "Competitor"} Battlecard\n\n`;

          const strengths = bc.strengths as string[] | null;
          const weaknesses = bc.weaknesses as string[] | null;
          const ourAdvantages = bc.ourAdvantages as string[] | null;
          const keyDifferentiators = bc.keyDifferentiators as { feature: string; ours: string; theirs: string }[] | null;
          const objections = bc.objections as { objection: string; response: string }[] | null;
          const talkTracks = bc.talkTracks as { scenario: string; script: string }[] | null;

          if (strengths && strengths.length > 0) {
            markdown += `**Their Strengths:**\n`;
            strengths.forEach((s) => markdown += `- ${s}\n`);
            markdown += `\n`;
          }

          if (weaknesses && weaknesses.length > 0) {
            markdown += `**Their Weaknesses:**\n`;
            weaknesses.forEach((w) => markdown += `- ${w}\n`);
            markdown += `\n`;
          }

          if (ourAdvantages && ourAdvantages.length > 0) {
            markdown += `**Our Advantages:**\n`;
            ourAdvantages.forEach((a) => markdown += `- ${a}\n`);
            markdown += `\n`;
          }

          if (keyDifferentiators && keyDifferentiators.length > 0) {
            markdown += `**Key Differentiators:**\n`;
            keyDifferentiators.forEach((d) => {
              markdown += `- **${d.feature}**: Ours: ${d.ours} | Theirs: ${d.theirs}\n`;
            });
            markdown += `\n`;
          }

          if (objections && objections.length > 0) {
            markdown += `**Objection Handling:**\n`;
            objections.forEach((o) => {
              markdown += `- *"${o.objection}"* → ${o.response}\n`;
            });
            markdown += `\n`;
          }

          if (talkTracks && talkTracks.length > 0) {
            markdown += `**Talk Tracks:**\n`;
            talkTracks.forEach((t) => {
              markdown += `- **${t.scenario}**: "${t.script}"\n`;
            });
            markdown += `\n`;
          }

          markdown += `---\n\n`;
        }
      }

      markdown += `\n---\n\n`;
      markdown += `*Report generated by [Orbit](https://orbit.synozur.com) - Go-to-Market Intelligence Platform*\n\n`;
      markdown += `© 2026 The Synozur Alliance LLC. All Rights Reserved.\n`;

      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${project.name.replace(/[^a-z0-9]/gi, "_")}_report.md"`);
      res.send(markdown);
    } catch (error: any) {
      console.error("Project export error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate Full Report - orchestrate all AI generations with one click
  app.post("/api/projects/:projectId/generate-full-report", async (req, res) => {
    try {
      const ctx = await getRequestContext(req);

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!validateResourceContext(project, ctx)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      if (!baselineProduct) {
        return res.status(400).json({ error: "No baseline product set. Add a baseline product first." });
      }

      const baseline = await storage.getProduct(baselineProduct.productId);
      const competitors = await Promise.all(
        competitorProducts.map(pp => storage.getProduct(pp.productId))
      );
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const results: { section: string; status: "success" | "error"; error?: string }[] = [];

      // Helper function to generate and save a section
      const generateSection = async (
        type: string,
        prompt: string,
        sectionName: string
      ): Promise<void> => {
        try {
          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-5",
            max_tokens: 4000,
            messages: [{ role: "user", content: prompt }],
          });

          // Log AI usage
          await logAiUsage(ctx, `generate_${type}`, "anthropic", "claude-sonnet-4-5", response.usage);

          const content = response.content[0].type === "text" ? response.content[0].text : "";

          const existing = await storage.getLongFormRecommendationByType(
            type,
            req.params.projectId,
            undefined
          );

          if (existing) {
            await storage.updateLongFormRecommendation(existing.id, {
              content,
              status: "generated",
              lastGeneratedAt: new Date(),
            });
          } else {
            await storage.createLongFormRecommendation({
              type,
              projectId: req.params.projectId,
              tenantDomain: ctx.tenantDomain,
              marketId: project.marketId || null,
              content,
              status: "generated",
              lastGeneratedAt: new Date(),
              generatedBy: ctx.userId,
            });
          }
          results.push({ section: sectionName, status: "success" });
        } catch (error: any) {
          console.error(`Failed to generate ${sectionName}:`, error);
          results.push({ section: sectionName, status: "error", error: error.message });
        }
      };

      // Build context for prompts
      const contextInfo = `
## Our Product
Name: ${baseline?.name}
Company: ${baseline?.companyName || "Unknown"}
Description: ${baseline?.description || "No description"}

## Competitors
${competitors.filter(Boolean).map(c => `- ${c?.name} (${c?.companyName || "Unknown"}): ${c?.description || "No description"}`).join("\n")}

## Battlecard Insights
${battlecards.map(bc => {
  const comp = competitors.find(c => c?.id === bc.competitorProductId);
  return `
Competitor: ${comp?.name || "Unknown"}
- Their Strengths: ${(Array.isArray(bc.strengths) ? (bc.strengths as string[]).join(", ") : "N/A")}
- Their Weaknesses: ${(Array.isArray(bc.weaknesses) ? (bc.weaknesses as string[]).join(", ") : "N/A")}
- Our Advantages: ${(Array.isArray(bc.ourAdvantages) ? (bc.ourAdvantages as string[]).join(", ") : "N/A")}`;
}).join("\n")}`;

      // Run all generations in parallel
      await Promise.allSettled([
        generateSection(
          "gap_analysis",
          `You are a competitive intelligence analyst. Analyze the positioning gaps for "${baseline?.name}" compared to its competitors.
${contextInfo}

Generate a comprehensive gap analysis in markdown format with sections:
# Gap Analysis
## Executive Summary
## Messaging Gaps  
## Feature Gaps
## Market Position Gaps
## Recommendations`,
          "Gap Analysis"
        ),
        generateSection(
          "strategic_recommendations",
          `You are a strategic advisor. Provide actionable recommendations for "${baseline?.name}" based on competitive analysis.
${contextInfo}

Generate strategic recommendations in markdown format with sections:
# Strategic Recommendations
## Priority Actions
## Competitive Differentiation Opportunities
## Market Expansion Strategies
## Risk Mitigation`,
          "Strategic Recommendations"
        ),
        generateSection(
          "competitive_summary",
          `You are a competitive intelligence analyst. Create a comprehensive competitive summary for "${baseline?.name}".
${contextInfo}

Generate a competitive landscape summary in markdown format with sections:
# Competitive Summary
## Market Overview
## Competitor Profiles
## Competitive Dynamics
## Key Takeaways`,
          "Competitive Summary"
        ),
        generateSection(
          "gtm_plan",
          `You are a go-to-market strategist. Create a GTM plan for "${baseline?.name}" considering the competitive landscape.
${contextInfo}

Generate a go-to-market plan in markdown format with sections:
# Go-to-Market Plan
## Target Market
## Value Proposition
## Channel Strategy
## Launch Tactics
## Success Metrics`,
          "GTM Plan"
        ),
        generateSection(
          "messaging_framework",
          `You are a marketing strategist. Create a messaging framework for "${baseline?.name}" that differentiates from competitors.
${contextInfo}

Generate a messaging framework in markdown format with sections:
# Messaging Framework
## Core Value Proposition
## Key Messages by Audience
## Competitive Positioning Statements
## Proof Points
## Call to Action Templates`,
          "Messaging Framework"
        ),
      ]);

      // Calculate competitor scores
      try {
        for (const pp of competitorProducts) {
          const product = pp.product;
          if (!product?.competitorId) continue;

          const competitor = await storage.getCompetitor(product.competitorId);
          const battlecard = battlecards.find(bc => bc.competitorProductId === pp.productId);

          let marketPresenceScore = 50;
          let innovationScore = 50;
          let pricingScore = 50;
          let featureBreadthScore = 50;
          let contentActivityScore = 50;
          let socialEngagementScore = 50;

          if (battlecard) {
            const strengthsArr = Array.isArray(battlecard.strengths) ? battlecard.strengths as string[] : [];
            const weaknessesArr = Array.isArray(battlecard.weaknesses) ? battlecard.weaknesses as string[] : [];
            featureBreadthScore = Math.min(100, 50 + (strengthsArr.length - weaknessesArr.length) * 5);
          }

          if (competitor?.linkedInEngagement) {
            const engagement = competitor.linkedInEngagement as any;
            if (engagement.followers > 10000) socialEngagementScore = 80;
            else if (engagement.followers > 5000) socialEngagementScore = 65;
          }

          const overallScore = Math.round(
            (marketPresenceScore * 0.25) +
            (innovationScore * 0.20) +
            (featureBreadthScore * 0.20) +
            (contentActivityScore * 0.15) +
            (socialEngagementScore * 0.10) +
            (pricingScore * 0.10)
          );

          const existingScore = await storage.getCompetitorScore(product.competitorId, req.params.projectId);
          const previousScore = existingScore?.overallScore || null;
          const trendDelta = previousScore !== null ? overallScore - previousScore : 0;
          const trendDirection = trendDelta > 5 ? "rising" : trendDelta < -5 ? "falling" : "stable";

          await storage.upsertCompetitorScore({
            competitorId: product.competitorId,
            projectId: req.params.projectId,
            tenantDomain: ctx.tenantDomain,
            marketId: project.marketId || null,
            overallScore,
            marketPresenceScore,
            innovationScore,
            pricingScore,
            featureBreadthScore,
            contentActivityScore,
            socialEngagementScore,
            trendDirection,
            trendDelta,
          });
        }
        results.push({ section: "Competitor Scores", status: "success" });
      } catch (error: any) {
        console.error("Failed to calculate scores:", error);
        results.push({ section: "Competitor Scores", status: "error", error: error.message });
      }

      const successful = results.filter(r => r.status === "success").length;
      const failed = results.filter(r => r.status === "error").length;

      res.json({
        message: `Report generation complete. ${successful} sections generated successfully${failed > 0 ? `, ${failed} failed` : ""}.`,
        results,
        allSuccess: failed === 0,
      });
    } catch (error: any) {
      console.error("Generate full report error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get side-by-side messaging comparison
  app.get("/api/projects/:projectId/messaging-comparison", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && !hasCrossTenantReadAccess(user.role)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const baselineProduct = projectProducts.find(pp => pp.role === "baseline");
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");

      // Extract messaging data from baseline
      const baselineAnalysis = baselineProduct?.product?.analysisData as any;
      const baseline = baselineProduct ? {
        id: baselineProduct.productId,
        name: baselineProduct.product?.name || "Your Product",
        companyName: baselineProduct.product?.companyName || "Your Company",
        messaging: {
          summary: baselineAnalysis?.summary || null,
          valueProposition: baselineAnalysis?.valueProposition || null,
          targetAudience: baselineAnalysis?.targetAudience || null,
          keyMessages: baselineAnalysis?.keyMessages || [],
          differentiators: baselineAnalysis?.differentiators || [],
          toneAndStyle: baselineAnalysis?.toneAndStyle || null,
        }
      } : null;

      // Extract messaging data from competitors
      const competitors = competitorProducts.map(cp => {
        const analysis = cp.product?.analysisData as any;
        return {
          id: cp.productId,
          name: cp.product?.name || "Unknown",
          companyName: cp.product?.companyName || "Unknown",
          messaging: {
            summary: analysis?.summary || null,
            valueProposition: analysis?.valueProposition || null,
            targetAudience: analysis?.targetAudience || null,
            keyMessages: analysis?.keyMessages || [],
            differentiators: analysis?.differentiators || [],
            toneAndStyle: analysis?.toneAndStyle || null,
          },
          hasAnalysis: !!analysis,
        };
      });

      res.json({
        baseline,
        competitors,
        totalCompetitors: competitorProducts.length,
        analyzedCompetitors: competitors.filter(c => c.hasAnalysis).length,
      });
    } catch (error: any) {
      console.error("Messaging comparison error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Calculate and update competitor scores
  app.post("/api/projects/:projectId/calculate-scores", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const project = await storage.getClientProject(req.params.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const tenantDomain = user.email.split("@")[1];
      if (project.tenantDomain !== tenantDomain && user.role !== "Global Admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      const projectProducts = await storage.getProjectProducts(req.params.projectId);
      const competitorProducts = projectProducts.filter(pp => pp.role === "competitor");
      const battlecards = await storage.getProductBattlecardsByProject(req.params.projectId);

      const scores = [];

      for (const cp of competitorProducts) {
        const product = cp.product;
        if (!product) continue;

        const battlecard = battlecards.find(bc => bc.competitorProductId === cp.productId);

        // Calculate component scores based on available data
        let marketPresenceScore = 50; // Default baseline
        let innovationScore = 50;
        let pricingScore = 50;
        let featureBreadthScore = 50;
        let contentActivityScore = 50;
        let socialEngagementScore = 50;

        // Get linked competitor data if available
        let competitor = null;
        if (product.competitorId) {
          competitor = await storage.getCompetitor(product.competitorId);
        }

        // Adjust based on competitor analysis data (if linked)
        if (competitor?.analysisData) {
          const analysis = competitor.analysisData as any;
          if (analysis.marketPosition) {
            marketPresenceScore = analysis.marketPosition === "leader" ? 90 : 
                                  analysis.marketPosition === "challenger" ? 70 : 50;
          }
          if (analysis.innovationLevel) {
            innovationScore = analysis.innovationLevel === "high" ? 85 : 
                             analysis.innovationLevel === "medium" ? 60 : 40;
          }
        }
        
        // Also adjust based on product's own analysis data
        if (product.analysisData) {
          const productAnalysis = product.analysisData as any;
          if (productAnalysis.competitiveScore) {
            // Use product's competitive score to influence overall
            marketPresenceScore = Math.round((marketPresenceScore + productAnalysis.competitiveScore) / 2);
          }
          if (productAnalysis.features?.length) {
            featureBreadthScore = Math.min(100, 40 + productAnalysis.features.length * 6);
          }
          // For standalone products, use additional product analysis fields
          if (productAnalysis.marketPosition) {
            marketPresenceScore = productAnalysis.marketPosition === "leader" ? 90 : 
                                  productAnalysis.marketPosition === "challenger" ? 70 : 50;
          }
          if (productAnalysis.innovationLevel) {
            innovationScore = productAnalysis.innovationLevel === "high" ? 85 : 
                             productAnalysis.innovationLevel === "medium" ? 60 : 40;
          }
        }

        // Adjust based on battlecard data
        if (battlecard) {
          const strengths = Array.isArray(battlecard.strengths) ? battlecard.strengths.length : 0;
          const weaknesses = Array.isArray(battlecard.weaknesses) ? battlecard.weaknesses.length : 0;
          featureBreadthScore = Math.min(100, 50 + (strengths - weaknesses) * 5);
          
          // Also boost innovation if battlecard shows strong differentiators
          if (battlecard.keyDifferentiators && Array.isArray(battlecard.keyDifferentiators)) {
            innovationScore = Math.min(100, 50 + battlecard.keyDifferentiators.length * 8);
          }
        }

        // Adjust based on social engagement from linked competitor
        if (competitor?.linkedInEngagement) {
          const engagement = competitor.linkedInEngagement as any;
          if (engagement.followers > 10000) socialEngagementScore = 80;
          else if (engagement.followers > 5000) socialEngagementScore = 65;
        }

        // Calculate overall score (weighted average)
        const overallScore = Math.round(
          (marketPresenceScore * 0.25) +
          (innovationScore * 0.20) +
          (featureBreadthScore * 0.20) +
          (contentActivityScore * 0.15) +
          (socialEngagementScore * 0.10) +
          (pricingScore * 0.10)
        );

        // Get previous score for trend calculation
        // Use product score lookup for standalone products, competitor score for linked products
        const existingScore = product.competitorId 
          ? await storage.getCompetitorScore(product.competitorId, req.params.projectId)
          : await storage.getProductScore(product.id, req.params.projectId);
        const previousScore = existingScore?.overallScore || null;
        const trendDelta = previousScore !== null ? overallScore - previousScore : 0;
        const trendDirection = trendDelta > 5 ? "rising" : trendDelta < -5 ? "falling" : "stable";

        // Build score data - use productId for standalone products, competitorId for linked
        const scorePayload = {
          competitorId: product.competitorId || null,
          productId: product.competitorId ? null : product.id, // Only set productId for standalone products
          projectId: req.params.projectId,
          tenantDomain,
          marketId: project.marketId || null,
          entityName: product.name,
          overallScore,
          marketPresenceScore,
          innovationScore,
          pricingScore,
          featureBreadthScore,
          contentActivityScore,
          socialEngagementScore,
          trendDirection,
          trendDelta,
          previousOverallScore: previousScore,
          scoreBreakdown: {
            marketPresence: { score: marketPresenceScore, weight: 0.25 },
            innovation: { score: innovationScore, weight: 0.20 },
            featureBreadth: { score: featureBreadthScore, weight: 0.20 },
            contentActivity: { score: contentActivityScore, weight: 0.15 },
            socialEngagement: { score: socialEngagementScore, weight: 0.10 },
            pricing: { score: pricingScore, weight: 0.10 },
          },
        };

        // Use appropriate upsert method based on product type
        const scoreData = product.competitorId 
          ? await storage.upsertCompetitorScore(scorePayload)
          : await storage.upsertProductScore(scorePayload);

        scores.push({
          ...scoreData,
          name: product.name,
        });
      }

      res.json({ success: true, scores });
    } catch (error: any) {
      console.error("Score calculation error:", error);
      res.status(500).json({ error: error.message });
    }
  });


}
