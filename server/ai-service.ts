import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export interface CompetitorAnalysis {
  summary: string;
  keyMessages: string[];
  targetAudience: string;
  valueProposition: string;
  keywords: string[];
  tone: string;
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

export async function analyzeCompetitorWebsite(
  competitorName: string,
  websiteUrl: string,
  websiteContent: string,
  groundingContext?: string
): Promise<CompetitorAnalysis> {
  // Build the prompt with optional grounding context
  let contextSection = "";
  if (groundingContext) {
    contextSection = `

IMPORTANT CONTEXT - Reference Documents (messaging frameworks, positioning, etc.):
${groundingContext.slice(0, 8000)}

Use this context to better understand the company's intended positioning and messaging when analyzing.
`;
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Analyze this company's website content and extract key marketing insights.

Company: ${competitorName}
Website: ${websiteUrl}
${contextSection}
Website Content:
${websiteContent.slice(0, 15000)}

Please provide a JSON response with the following structure:
{
  "summary": "Brief 2-3 sentence summary of their positioning",
  "keyMessages": ["Main message 1", "Main message 2", "Main message 3"],
  "targetAudience": "Who they are targeting",
  "valueProposition": "Their main value proposition",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "tone": "Professional/Casual/Technical/etc"
}

Return ONLY valid JSON, no additional text.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  try {
    // Handle markdown-wrapped JSON responses
    let text = content.text.trim();
    if (text.startsWith("```json")) {
      text = text.slice(7);
    } else if (text.startsWith("```")) {
      text = text.slice(3);
    }
    if (text.endsWith("```")) {
      text = text.slice(0, -3);
    }
    return JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse AI response:", content.text, e);
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
  // Build comprehensive context including baseline and grounding documents
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

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Based on our company analysis, positioning documents, and competitor analyses, identify gaps in our market strategy.

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

Return ONLY valid JSON array, no additional text.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  try {
    let text = content.text.trim();
    if (text.startsWith("```json")) {
      text = text.slice(7);
    } else if (text.startsWith("```")) {
      text = text.slice(3);
    }
    if (text.endsWith("```")) {
      text = text.slice(0, -3);
    }
    return JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse gap analysis response:", content.text, e);
    return [];
  }
}

export async function generateRecommendations(
  gaps: GapAnalysis[],
  competitorAnalyses: CompetitorAnalysis[]
): Promise<Recommendation[]> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Based on these gaps and competitor analyses, generate actionable recommendations.

Gaps Identified:
${JSON.stringify(gaps, null, 2)}

Competitor Insights:
${JSON.stringify(competitorAnalyses, null, 2)}

Please generate 3-5 recommendations and return as a JSON array:
[
  {
    "title": "Short actionable title",
    "description": "Detailed description of what to do",
    "area": "Messaging/Features/Content/Positioning",
    "impact": "High/Medium/Low",
    "rationale": "Why this recommendation matters based on competitive data"
  }
]

Return ONLY valid JSON array, no additional text.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  try {
    let text = content.text.trim();
    if (text.startsWith("```json")) {
      text = text.slice(7);
    } else if (text.startsWith("```")) {
      text = text.slice(3);
    }
    if (text.endsWith("```")) {
      text = text.slice(0, -3);
    }
    return JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse recommendations response:", content.text, e);
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

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Compare these two versions of website content and identify meaningful changes.

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

Return ONLY valid JSON, no additional text.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    return { hasChanges: false, description: "", impact: "Low" };
  }

  try {
    let text = content.text.trim();
    if (text.startsWith("```json")) {
      text = text.slice(7);
    } else if (text.startsWith("```")) {
      text = text.slice(3);
    }
    if (text.endsWith("```")) {
      text = text.slice(0, -3);
    }
    return JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse change detection response:", content.text, e);
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

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are a product strategy advisor. Based on competitive intelligence, suggest roadmap recommendations for the following product.

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

Return ONLY valid JSON array, no additional text.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  try {
    let text = content.text.trim();
    if (text.startsWith("```json")) {
      text = text.slice(7);
    } else if (text.startsWith("```")) {
      text = text.slice(3);
    }
    if (text.endsWith("```")) {
      text = text.slice(0, -3);
    }
    return JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse roadmap recommendations:", content.text, e);
    return [];
  }
}

// Feature extraction from URL content or pasted text
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
  
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a product analyst extracting ALL product features and capabilities from ${sourceType === "url" ? "a website" : "provided text"} ${contextInfo}.

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
Return ONLY valid JSON array, no additional text.`,
      },
    ],
  });

  const responseContent = message.content[0];
  if (responseContent.type !== "text") {
    throw new Error("Unexpected response type");
  }

  try {
    let text = responseContent.text.trim();
    if (text.startsWith("```json")) {
      text = text.slice(7);
    } else if (text.startsWith("```")) {
      text = text.slice(3);
    }
    if (text.endsWith("```")) {
      text = text.slice(0, -3);
    }
    return JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse extracted features:", responseContent.text, e);
    return [];
  }
}

// Roadmap item extraction from content
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
  
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are a product analyst extracting roadmap items from ${sourceType === "url" ? "a website" : "provided text"} ${contextInfo}.

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
Return ONLY valid JSON array, no additional text.`,
      },
    ],
  });

  const responseContent = message.content[0];
  if (responseContent.type !== "text") {
    throw new Error("Unexpected response type");
  }

  try {
    let text = responseContent.text.trim();
    if (text.startsWith("```json")) {
      text = text.slice(7);
    } else if (text.startsWith("```")) {
      text = text.slice(3);
    }
    if (text.endsWith("```")) {
      text = text.slice(0, -3);
    }
    return JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse extracted roadmap:", responseContent.text, e);
    return [];
  }
}
