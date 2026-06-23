/**
 * Outreach Composer service.
 *
 * Generates one outreach touch (email or LinkedIn) for a prospect, grounded in
 * the prospect dossier, the campaign's voice profile, strategic context
 * (positioning / objections), and the right campaign resource for the step.
 * Every draft is scanned by `compliance-core` before it is persisted as
 * `draft_pending_approval`. Pure prompt/parse logic lives in
 * `outreach-composer-core.ts`.
 */

import { db } from "../db";
import {
  prospects,
  outreachCampaigns,
  outreachTouches,
  cadenceSteps,
  outreachCampaignResources,
  socialAccountVoiceProfiles,
  emailSuppressions,
  contentAssets,
  marketingLinks,
  conferences,
  type Prospect,
  type OutreachTouch,
  type OutreachChannel,
  type SocialAccountVoiceProfile,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { completeForFeature } from "./ai-provider";
import { loadStrategicContext, formatStrategicContextForPrompt } from "./strategic-context";
import {
  buildComposePrompt,
  parseComposeResponse,
  enforceLength,
  COMPOSER_SYSTEM_PROMPT,
  type ComposeResource,
} from "./outreach-composer-core";
import { scanCompliance, type ComplianceResult } from "./compliance-core";
import type { LinkedInFormat, OutreachIntent } from "@shared/linkedin-outreach";

export interface ComposeTouchOptions {
  channel?: OutreachChannel;
  stepNumber?: number;
  isDefaultMarket?: boolean;
  /** LinkedIn message shape (connect note vs DM). Ignored for email. */
  linkedinFormat?: LinkedInFormat | null;
  /** Draft intent — outreach (ask) vs engagement (warm, no ask). */
  intent?: OutreachIntent | null;
}

export interface ComposeTouchResult {
  touch: OutreachTouch;
  prospect: Prospect;
  compliance: ComplianceResult;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  provider: string;
}

/** Format a voice profile into a prompt block + extract forbidden phrases. */
function formatVoiceBlock(v: SocialAccountVoiceProfile | undefined): { block: string; forbidden: string[] } {
  if (!v) return { block: "", forbidden: [] };
  const tone = v.toneAttributes ? Object.entries(v.toneAttributes).filter(([, on]) => on).map(([k]) => k) : [];
  const lines = [
    "## Voice",
    v.styleGuidance ? v.styleGuidance : "",
    tone.length ? `Tone: ${tone.join(", ")}` : "",
    (v.preferredPhrases?.length ?? 0) > 0 ? `Prefer: ${v.preferredPhrases!.join(", ")}` : "",
    (v.forbiddenPhrases?.length ?? 0) > 0 ? `Never use: ${v.forbiddenPhrases!.join(", ")}` : "",
    (v.sampleSnippets?.length ?? 0) > 0
      ? `Voice samples:\n${v.sampleSnippets!.slice(0, 3).map((s) => `- ${s.content}`).join("\n")}`
      : "",
    v.soundLikeMeInstructions
      ? `\nWriting instructions (follow exactly):\n${v.soundLikeMeInstructions.trim()}`
      : "",
  ].filter(Boolean);
  return { block: lines.join("\n"), forbidden: v.forbiddenPhrases ?? [] };
}

/** Find the resource to surface for a given step (explicit injectAtStep wins). */
async function resolveStepResource(campaignId: string, stepNumber: number): Promise<ComposeResource | null> {
  const rows = await db
    .select()
    .from(outreachCampaignResources)
    .where(eq(outreachCampaignResources.campaignId, campaignId));
  if (rows.length === 0) return null;
  const match = rows.find((r) => r.injectAtStep === stepNumber) ?? null;
  if (!match) return null;

  let url: string | null = null;
  if (match.marketingLinkId) {
    const [link] = await db.select().from(marketingLinks).where(eq(marketingLinks.id, match.marketingLinkId));
    url = link?.destinationUrl ?? null;
  } else if (match.contentAssetId) {
    const [asset] = await db.select().from(contentAssets).where(eq(contentAssets.id, match.contentAssetId));
    url = asset?.url ?? asset?.fileUrl ?? null;
  }
  return { label: match.label, resourceType: match.resourceType, url };
}

/**
 * Load the inputs a compliance scan needs (suppression list, own domain, and
 * the voice profile's forbidden phrases) so routes can re-scan an edited draft.
 */
export async function loadComplianceContext(
  tenantDomain: string,
  voiceProfileId?: string | null,
): Promise<{ suppressedEmails: string[]; ownDomains: string[]; forbidden: string[] }> {
  const suppressions = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.tenantDomain, tenantDomain));
  let forbidden: string[] = [];
  if (voiceProfileId) {
    const [v] = await db
      .select()
      .from(socialAccountVoiceProfiles)
      .where(eq(socialAccountVoiceProfiles.id, voiceProfileId));
    forbidden = v?.forbiddenPhrases ?? [];
  }
  return {
    suppressedEmails: suppressions.map((s) => s.email.toLowerCase()),
    ownDomains: [tenantDomain],
    forbidden,
  };
}

export async function composeTouch(
  tenantDomain: string,
  prospectId: string,
  opts: ComposeTouchOptions = {},
): Promise<ComposeTouchResult> {
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, prospectId));
  if (!prospect || prospect.tenantDomain !== tenantDomain) throw new Error("Prospect not found");

  const [campaign] = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, prospect.campaignId));
  if (!campaign) throw new Error("Campaign not found");

  const channel: OutreachChannel = opts.channel ?? ((campaign.channels?.[0] as OutreachChannel) || "email");
  const stepNumber = opts.stepNumber ?? 1;
  // LinkedIn shape + intent (null/ignored for email). Default to a direct
  // message; the caller (UI) picks connect-request when appropriate.
  const linkedinFormat: LinkedInFormat | null =
    channel === "linkedin" ? opts.linkedinFormat ?? "direct_message" : null;
  const intent: OutreachIntent = opts.intent ?? "outreach";

  // Cadence step purpose (best-effort lookup).
  let purpose = "intro";
  if (campaign.cadenceTemplateId) {
    const steps = await db
      .select()
      .from(cadenceSteps)
      .where(eq(cadenceSteps.templateId, campaign.cadenceTemplateId));
    const step = steps.find((s) => s.stepNumber === stepNumber && s.channel === channel)
      ?? steps.find((s) => s.stepNumber === stepNumber);
    if (step) purpose = step.purpose;
  }

  // Voice profile (campaign's personal profile).
  let voice: SocialAccountVoiceProfile | undefined;
  if (campaign.voiceProfileId) {
    const [v] = await db
      .select()
      .from(socialAccountVoiceProfiles)
      .where(eq(socialAccountVoiceProfiles.id, campaign.voiceProfileId));
    voice = v;
  }
  const { block: voiceBlock, forbidden } = formatVoiceBlock(voice);

  const strategicCtx = await loadStrategicContext(tenantDomain, campaign.marketId || undefined, opts.isDefaultMarket);
  const strategicBlock = formatStrategicContextForPrompt(strategicCtx);

  const resource = await resolveStepResource(campaign.id, stepNumber);

  // Load the linked conference so the AI uses real event facts, not invented ones.
  let eventBlock: string | null = null;
  if (campaign.conferenceId) {
    const [conf] = await db.select().from(conferences).where(eq(conferences.id, campaign.conferenceId));
    if (conf) {
      const dateStr = conf.startDate
        ? new Date(conf.startDate).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
        : null;
      const lines = [
        "## Event — use these facts verbatim; do not invent or substitute any event details",
        `Name: ${conf.name}`,
        dateStr ? `Date: ${dateStr}` : null,
        conf.location ? `Location: ${conf.location}` : null,
        conf.website ? `RSVP / details URL: ${conf.website}` : null,
        (conf.description || conf.thematicBrief)
          ? `Description: ${(conf.description || conf.thematicBrief || "").slice(0, 600)}`
          : null,
      ].filter(Boolean);
      eventBlock = lines.join("\n");
    }
  }

  const prompt = buildComposePrompt({
    channel,
    stepNumber,
    purpose,
    prospect: { name: prospect.name, title: prospect.title, companyName: prospect.companyName },
    dossier: prospect.researchDossier,
    salesGoal: campaign.salesGoal,
    callToAction: campaign.interview?.callToAction ?? null,
    strategicBlock,
    voiceBlock,
    resource,
    linkedinFormat,
    intent,
    eventBlock,
  });

  const result = await completeForFeature("outreach_composer", prompt, {
    tenantDomain,
    systemPrompt: COMPOSER_SYSTEM_PROMPT,
    maxTokens: 1200,
  });

  const parsed = parseComposeResponse(result.text, channel);
  const body = enforceLength(parsed.body, channel, linkedinFormat);

  // Compliance scan: suppression list + own domain + voice forbidden phrases.
  const suppressions = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.tenantDomain, tenantDomain));
  const compliance = scanCompliance({
    channel,
    subject: parsed.subject,
    body,
    recipientEmail: prospect.email,
    suppressedEmails: suppressions.map((s) => s.email.toLowerCase()),
    ownDomains: [tenantDomain],
    forbiddenPhrases: forbidden,
  });

  const [touch] = await db
    .insert(outreachTouches)
    .values({
      prospectId: prospect.id,
      campaignId: campaign.id,
      tenantDomain,
      channel,
      linkedinFormat,
      intent,
      stepNumber,
      subject: parsed.subject,
      body,
      status: "draft_pending_approval",
      complianceFlags: compliance,
      voiceProfileId: campaign.voiceProfileId ?? null,
    })
    .returning();

  // Advance the prospect into the draft-review state. Covers first-touch
  // (new/researched) and follow-ups composed for a due cadence step.
  let updatedProspect = prospect;
  if (prospect.status === "new" || prospect.status === "researched" || prospect.status === "cadence_step_due") {
    const [u] = await db
      .update(prospects)
      .set({ status: "draft_pending_approval", updatedAt: new Date() })
      .where(eq(prospects.id, prospect.id))
      .returning();
    updatedProspect = u;
  }

  return {
    touch,
    prospect: updatedProspect,
    compliance,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    model: result.model,
    provider: result.provider,
  };
}
