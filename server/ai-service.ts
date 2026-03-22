import { AI_FEATURES, type AIFeature } from "@shared/schema";
import { completeForFeature, type AICompletionResult } from "./services/ai-provider";

export interface CompetitorAnalysis {
  summary: string;
  keyMessages: string[];
  targetAudience: string;
  valueProposition: string;
  keywords: string[];
  tone: string;
  headquarters?: string;
  foundedYear?: number;
  revenueRange?: string;
  fundingInfo?: string;
  companyDescription?: string;
  industry?: string;
  employeeCount?: number;
  followerCount?: number;
  socialPresence?: string;
  recentPostThemes?: string[];
}

export interface LinkedInContext {
  companyDescription?: string;
  industry?: string;
  employeeCount?: number;
  followerCount?: number;
  recentPosts?: Array<{
    text: string;
    reactions?: number;
    comments?: number;
  }>;
}

export type GapCategory = "messaging" | "features" | "audience" | "content" | "positioning" | "other";

export interface GapAnalysis {
  area: string;
  category: GapCategory;
  impact: string;
  observation: string;
}

export interface Recommendation {
  title: string;
  description: string;
  area: string;
  impact: string;
  rationale: string;
}

function parseJsonResponse<T>(text: string, fallback: T): T {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  return JSON.parse(cleaned.trim());
}

function parseJsonArrayResponse<T>(text: string): T[] {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "").trim();
  
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // try truncation recovery
      }
    }
    
    const arrayStart = cleaned.indexOf("[");
    if (arrayStart !== -1) {
      let partial = cleaned.slice(arrayStart);
      partial = partial.replace(/,\s*\{[^}]*$/, "");
      if (!partial.endsWith("]")) {
        partial = partial + "]";
      }
      try {
        const recovered = JSON.parse(partial);
        console.log(`[AI Parse] Recovered ${recovered.length} items from truncated response`);
        return recovered;
      } catch {
        // ignore
      }
    }
    
    throw new Error("No JSON array found in response");
  }
}

export interface AICallResult<T> {
  data: T;
  completion: AICompletionResult;
}

export async function analyzeCompetitorWebsite(
  competitorName: string,
  websiteUrl: string,
  websiteContent: string,
  groundingContext?: string,
  linkedInData?: LinkedInContext
): Promise<CompetitorAnalysis> {
  let contextSection = "";
  if (groundingContext) {
    contextSection = `

IMPORTANT CONTEXT - Reference Documents (messaging frameworks, positioning, etc.):
${groundingContext.slice(0, 8000)}

Use this context to better understand the company's intended positioning and messaging when analyzing.
`;
  }

  let linkedInSection = "";
  if (linkedInData) {
    const linkedInParts: string[] = [];
    if (linkedInData.companyDescription) {
      linkedInParts.push(`Company Description: ${linkedInData.companyDescription}`);
    }
    if (linkedInData.industry) {
      linkedInParts.push(`Industry: ${linkedInData.industry}`);
    }
    if (linkedInData.employeeCount) {
      linkedInParts.push(`Employee Count: ${linkedInData.employeeCount.toLocaleString()}`);
    }
    if (linkedInData.followerCount) {
      linkedInParts.push(`LinkedIn Followers: ${linkedInData.followerCount.toLocaleString()}`);
    }
    if (linkedInData.recentPosts && linkedInData.recentPosts.length > 0) {
      const postsPreview = linkedInData.recentPosts.slice(0, 5).map((p, i) => 
        `  ${i + 1}. "${p.text.substring(0, 200)}..." (${p.reactions || 0} reactions, ${p.comments || 0} comments)`
      ).join("\n");
      linkedInParts.push(`Recent LinkedIn Posts:\n${postsPreview}`);
    }
    if (linkedInParts.length > 0) {
      linkedInSection = `

LINKEDIN PROFILE DATA:
${linkedInParts.join("\n")}

Use this LinkedIn data to understand their social presence, thought leadership themes, and company positioning.
`;
    }
  }

  const prompt = `Analyze this company's website content${linkedInData ? " and LinkedIn presence" : ""} and extract key marketing insights.

Company: ${competitorName}
Website: ${websiteUrl}
${contextSection}${linkedInSection}
Website Content:
${websiteContent.slice(0, 15000)}

Please provide a JSON response with the following structure:
{
  "summary": "Brief 2-3 sentence summary of their positioning${linkedInData ? " including social presence insights" : ""}",
  "keyMessages": ["Main message 1", "Main message 2", "Main message 3"],
  "targetAudience": "Who they are targeting",
  "valueProposition": "Their main value proposition",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "tone": "Professional/Casual/Technical/etc",
  "headquarters": "City, State/Country if mentioned on About page or footer (null if not found)",
  "foundedYear": 2010,
  "revenueRange": "Revenue range if mentioned, e.g. '$10M-$50M' or 'Enterprise' (null if not found)",
  "fundingInfo": "Funding info if mentioned, e.g. 'Series B, $25M raised' (null if not found)"${linkedInData ? `,
  "companyDescription": "Their LinkedIn company description or tagline",
  "industry": "Their stated industry",
  "employeeCount": ${linkedInData.employeeCount ?? "null"},
  "followerCount": ${linkedInData.followerCount ?? "null"},
  "socialPresence": "Assessment of their LinkedIn activity level and engagement (Strong/Moderate/Minimal)",
  "recentPostThemes": ["Theme 1 from their posts", "Theme 2", "Theme 3"]` : ""}
}

Note: For headquarters, foundedYear, revenueRange, and fundingInfo, only include if explicitly stated on the website (About page, footer, press releases). Return null if not found - do not guess.

Return ONLY valid JSON, no additional text.`;

  const result = await completeForFeature(AI_FEATURES.COMPETITOR_ANALYSIS, prompt, { maxTokens: 2048 });

  try {
    return parseJsonResponse<CompetitorAnalysis>(result.text, {
      summary: "Analysis could not be completed",
      keyMessages: [],
      targetAudience: "Unknown",
      valueProposition: "Unknown",
      keywords: [],
      tone: "Unknown",
    });
  } catch (e) {
    console.error("Failed to parse AI response:", result.text, e);
    return {
      summary: "Analysis could not be completed",
      keyMessages: [],
      targetAudience: "Unknown",
      valueProposition: "Unknown",
      keywords: [],
      tone: "Unknown",
    };
  }
}

export async function generateGapAnalysis(
  ourPositioning: string,
  competitorAnalyses: CompetitorAnalysis[],
  baselineAnalysis?: CompetitorAnalysis,
  groundingContext?: string
): Promise<GapAnalysis[]> {
  let baselineSection = "";
  if (baselineAnalysis) {
    baselineSection = `
OUR COMPANY ANALYSIS (Baseline):
${JSON.stringify(baselineAnalysis, null, 2)}
`;
  }

  let groundingSection = "";
  if (groundingContext) {
    groundingSection = `
REFERENCE DOCUMENTS (Messaging Frameworks, Positioning Guides, etc.):
${groundingContext.slice(0, 6000)}
`;
  }

  const prompt = `Based on our company analysis, positioning documents, and competitor analyses, identify gaps in our market strategy.

Our Positioning Statement: ${ourPositioning}
${baselineSection}
${groundingSection}
Competitor Analyses:
${JSON.stringify(competitorAnalyses, null, 2)}

Compare our baseline company against competitors. Consider:
1. Messaging and positioning differences
2. Target audience alignment
3. Value proposition gaps
4. Feature or capability gaps
5. Content and thought leadership gaps

Please identify 3-5 key gaps and return as a JSON array:
[
  {
    "area": "Specific area name describing the gap",
    "category": "messaging|features|audience|content|positioning|other",
    "impact": "High/Medium/Low",
    "observation": "Detailed observation about the gap, referencing specific differences between our company and competitors"
  }
]

Categories:
- messaging: Messaging, value propositions, taglines, brand voice
- features: Product features, capabilities, functionality gaps
- audience: Target audience, market segments, personas
- content: Content marketing, thought leadership, blog, resources
- positioning: Market positioning, differentiation, competitive stance
- other: Other gaps that don't fit above categories

Return ONLY valid JSON array, no additional text.`;

  const result = await completeForFeature(AI_FEATURES.GAP_ANALYSIS, prompt, { maxTokens: 2048 });

  try {
    return parseJsonResponse<GapAnalysis[]>(result.text, []);
  } catch (e) {
    console.error("Failed to parse gap analysis response:", result.text, e);
    return [];
  }
}

export interface ExistingRecommendation {
  title: string;
  description: string;
  area: string;
  status: string;
  dismissedReason?: string;
  thumbsUp?: number;
  thumbsDown?: number;
}

export async function generateRecommendations(
  gaps: GapAnalysis[],
  competitorAnalyses: CompetitorAnalysis[],
  existingRecommendations?: ExistingRecommendation[]
): Promise<Recommendation[]> {
  let existingContext = "";
  let feedbackLearningContext = "";
  
  if (existingRecommendations && existingRecommendations.length > 0) {
    const dismissed = existingRecommendations.filter(r => r.status === "dismissed");
    const active = existingRecommendations.filter(r => r.status !== "dismissed");
    
    if (dismissed.length > 0) {
      existingContext += `\n\nPREVIOUSLY DISMISSED RECOMMENDATIONS (DO NOT regenerate these or similar):
${dismissed.map(r => `- "${r.title}" (Reason: ${r.dismissedReason || "user dismissed"})`).join("\n")}`;
    }
    
    if (active.length > 0) {
      existingContext += `\n\nEXISTING ACTIVE RECOMMENDATIONS (avoid duplicates):
${active.map(r => `- "${r.title}"`).join("\n")}`;
    }
    
    const highlyRated = existingRecommendations.filter(r => 
      (r.thumbsUp || 0) > 0 && (r.thumbsUp || 0) > (r.thumbsDown || 0)
    );
    const poorlyRated = existingRecommendations.filter(r => 
      (r.thumbsDown || 0) > 0 && (r.thumbsDown || 0) > (r.thumbsUp || 0)
    );
    
    if (highlyRated.length > 0 || poorlyRated.length > 0) {
      feedbackLearningContext = "\n\nUSER FEEDBACK LEARNING:";
      
      if (highlyRated.length > 0) {
        feedbackLearningContext += `\n\nHIGHLY-RATED RECOMMENDATIONS (users found these helpful - generate similar style/approach):
${highlyRated.slice(0, 5).map(r => `- "${r.title}" [Area: ${r.area}] - ${r.description.substring(0, 100)}...`).join("\n")}`;
      }
      
      if (poorlyRated.length > 0) {
        feedbackLearningContext += `\n\nPOORLY-RATED RECOMMENDATIONS (users found these unhelpful - AVOID similar approaches):
${poorlyRated.slice(0, 5).map(r => `- "${r.title}" [Area: ${r.area}] - AVOID: ${r.description.substring(0, 80)}...`).join("\n")}`;
      }
    }
  }

  const prompt = `Based on these gaps and competitor analyses, generate actionable recommendations.

Gaps Identified:
${JSON.stringify(gaps, null, 2)}

Competitor Insights:
${JSON.stringify(competitorAnalyses, null, 2)}
${existingContext}
${feedbackLearningContext}

IMPORTANT RULES:
1. DO NOT generate recommendations that are similar to dismissed ones
2. DO NOT duplicate existing active recommendations
3. Focus on NEW, unique insights not already covered
4. LEARN from user feedback: Generate recommendations similar in style/approach to highly-rated ones
5. AVOID patterns from poorly-rated recommendations

Please generate 3-5 NEW recommendations and return as a JSON array:
[
  {
    "title": "Short actionable title",
    "description": "Detailed description of what to do",
    "area": "Messaging/Features/Content/Positioning",
    "impact": "High/Medium/Low",
    "rationale": "Why this recommendation matters based on competitive data"
  }
]

Return ONLY valid JSON array, no additional text.`;

  const result = await completeForFeature(AI_FEATURES.RECOMMENDATIONS, prompt, { maxTokens: 2048 });

  try {
    return parseJsonResponse<Recommendation[]>(result.text, []);
  } catch (e) {
    console.error("Failed to parse recommendations response:", result.text, e);
    return [];
  }
}

export async function detectChanges(
  previousContent: string,
  currentContent: string
): Promise<{ hasChanges: boolean; description: string; impact: string }> {
  if (!previousContent || previousContent === currentContent) {
    return { hasChanges: false, description: "", impact: "Low" };
  }

  const prompt = `Compare these two versions of website content and identify meaningful changes.

Previous:
${previousContent.slice(0, 3000)}

Current:
${currentContent.slice(0, 3000)}

Return a JSON response:
{
  "hasChanges": true/false,
  "description": "Brief description of the key changes",
  "impact": "High/Medium/Low"
}

Return ONLY valid JSON, no additional text.`;

  try {
    const result = await completeForFeature(AI_FEATURES.CHANGE_DETECTION, prompt, { maxTokens: 512 });
    return parseJsonResponse(result.text, { hasChanges: false, description: "", impact: "Low" });
  } catch (e) {
    console.error("Failed change detection:", e);
    return { hasChanges: false, description: "", impact: "Low" };
  }
}

export interface RoadmapRecommendation {
  type: "gap" | "opportunity" | "priority" | "risk";
  title: string;
  explanation: string;
  suggestedPriority: "high" | "medium" | "low";
  suggestedQuarter: string | null;
  relatedCompetitors: string[];
}

export async function generateRoadmapRecommendations(
  productName: string,
  productDescription: string,
  existingFeatures: { name: string; status: string; category: string | null }[],
  competitorData: { name: string; analysis: string }[]
): Promise<RoadmapRecommendation[]> {
  const featuresContext = existingFeatures.length > 0
    ? existingFeatures.map(f => `- ${f.name} (${f.status}${f.category ? `, ${f.category}` : ""})`).join("\n")
    : "No features documented yet.";

  const competitorContext = competitorData.length > 0
    ? competitorData.map(c => `Competitor: ${c.name}\nAnalysis: ${c.analysis}`).join("\n\n")
    : "No competitor analysis available yet.";

  const prompt = `You are a product strategy advisor. Based on competitive intelligence, suggest roadmap recommendations for the following product.

PRODUCT: ${productName}
${productDescription ? `Description: ${productDescription}` : ""}

CURRENT FEATURES:
${featuresContext}

COMPETITIVE INTELLIGENCE:
${competitorContext.slice(0, 10000)}

Analyze the competitive landscape and suggest 3-5 roadmap recommendations. Each recommendation should be one of these types:
- "gap": Feature gaps where competitors have capabilities the product lacks
- "opportunity": Market opportunities to differentiate from competitors
- "priority": Suggestions to reprioritize existing planned features
- "risk": Risks if certain features are not addressed

Return a JSON array with recommendations in this format:
[
  {
    "type": "gap|opportunity|priority|risk",
    "title": "Recommendation title",
    "explanation": "Detailed explanation of why this is important and how it relates to competitive positioning (2-3 sentences)",
    "suggestedPriority": "high|medium|low",
    "suggestedQuarter": "Q1|Q2|Q3|Q4" or null,
    "relatedCompetitors": ["CompetitorName1", "CompetitorName2"]
  }
]

Return ONLY valid JSON array, no additional text.`;

  const result = await completeForFeature(AI_FEATURES.ROADMAP_RECOMMENDATIONS, prompt, { maxTokens: 2048 });

  try {
    return parseJsonResponse<RoadmapRecommendation[]>(result.text, []);
  } catch (e) {
    console.error("Failed to parse roadmap recommendations:", result.text, e);
    return [];
  }
}

export interface ExtractedFeature {
  name: string;
  description: string | null;
  category: string | null;
  status: "backlog" | "planned" | "in_progress" | "released";
}

export async function extractFeaturesFromContent(
  content: string,
  sourceType: "url" | "text",
  productName?: string
): Promise<ExtractedFeature[]> {
  const contextInfo = productName ? `for the product "${productName}"` : "";
  
  const prompt = `You are a product analyst extracting ALL product features and capabilities from ${sourceType === "url" ? "a website" : "provided text"} ${contextInfo}.

IMPORTANT: Be thorough and extract EVERY distinct feature, capability, module, and functionality mentioned. Marketing pages often describe many features - capture them all.

Look for and extract:
- Named modules or product components (e.g., "Strategy Module", "AI Assistant")
- Core capabilities and workflows
- Integrations with other platforms (each integration is a separate feature)
- Security features and compliance certifications (SOC 2, encryption, SSO, RBAC, audit logs)
- User experience features
- Platform features (access control, multi-tenant, etc.)
- AI-powered features and automation
- Analytics, reporting, and dashboard capabilities
- Meeting/collaboration features
- Any feature mentioned in bullet points or feature lists

For each feature found, determine:
1. A clear, concise name (max 60 characters)
2. A brief description (1-2 sentences explaining what it does)
3. A category: Core, Security, Analytics, Integration, UX, Performance, API, or Other
4. Status: "released" if it appears to be live/available, "planned" if mentioned as upcoming/roadmap, "in_progress" if in beta/preview, "backlog" if just mentioned as an idea

CONTENT:
${content.slice(0, 15000)}

Return a JSON array of features. Each feature should have:
- name: string (concise feature name)
- description: string or null
- category: string or null (one of: Core, Security, Analytics, Integration, UX, Performance, API, Other)
- status: "backlog" | "planned" | "in_progress" | "released"

Be comprehensive! Extract 10-30 features if the content has that many. Each distinct capability, module, integration, or security feature should be its own entry. Do not be conservative - if something sounds like a feature, include it.
Return ONLY valid JSON array, no additional text or code fences.`;

  const result = await completeForFeature(AI_FEATURES.FEATURE_EXTRACTION, prompt, { maxTokens: 8192 });

  try {
    return parseJsonArrayResponse<ExtractedFeature>(result.text);
  } catch (e) {
    console.error("Failed to parse extracted features:", result.text.slice(0, 500), e);
    return [];
  }
}

export interface ExtractedRoadmapItem {
  title: string;
  description: string | null;
  quarter: string | null;
  effort: "xs" | "s" | "m" | "l" | "xl" | null;
}

export async function extractRoadmapFromContent(
  content: string,
  sourceType: "url" | "text",
  productName?: string
): Promise<ExtractedRoadmapItem[]> {
  const contextInfo = productName ? `for the product "${productName}"` : "";
  
  const prompt = `You are a product analyst extracting roadmap items from ${sourceType === "url" ? "a website" : "provided text"} ${contextInfo}.

Analyze the following content and extract roadmap items, upcoming features, or planned work. For each item:
1. A clear title (max 80 characters)
2. A brief description
3. Target quarter if mentioned (Q1, Q2, Q3, Q4) or null
4. Estimated effort if inferable: xs (hours), s (1-2 days), m (3-5 days), l (1-2 weeks), xl (3+ weeks), or null

CONTENT:
${content.slice(0, 15000)}

Return a JSON array of roadmap items. Each should have:
- title: string
- description: string or null
- quarter: "Q1" | "Q2" | "Q3" | "Q4" | null
- effort: "xs" | "s" | "m" | "l" | "xl" | null

Extract 3-15 roadmap items. Focus on planned or upcoming work.
Return ONLY valid JSON array, no additional text.`;

  const result = await completeForFeature(AI_FEATURES.ROADMAP_RECOMMENDATIONS, prompt, { maxTokens: 4096 });

  try {
    return parseJsonArrayResponse<ExtractedRoadmapItem>(result.text);
  } catch (e) {
    console.error("Failed to parse extracted roadmap:", result.text.slice(0, 500), e);
    return [];
  }
}
