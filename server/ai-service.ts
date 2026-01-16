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

export interface GapAnalysis {
  area: string;
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
  websiteContent: string
): Promise<CompetitorAnalysis> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Analyze this competitor's website content and extract key marketing insights.

Competitor: ${competitorName}
Website: ${websiteUrl}

Content:
${websiteContent.slice(0, 10000)}

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
    return JSON.parse(content.text);
  } catch {
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
  competitorAnalyses: CompetitorAnalysis[]
): Promise<GapAnalysis[]> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Based on our positioning and competitor analyses, identify gaps in our market strategy.

Our Positioning: ${ourPositioning}

Competitor Analyses:
${JSON.stringify(competitorAnalyses, null, 2)}

Please identify 3-5 key gaps and return as a JSON array:
[
  {
    "area": "Area name (e.g., Messaging, Features, Audience)",
    "impact": "High/Medium/Low",
    "observation": "Detailed observation about the gap"
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
    return JSON.parse(content.text);
  } catch {
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
    return JSON.parse(content.text);
  } catch {
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
    return JSON.parse(content.text);
  } catch {
    return { hasChanges: false, description: "", impact: "Low" };
  }
}
