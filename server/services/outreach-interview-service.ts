/**
 * Outreach Interview service.
 *
 * Persists the outcome of the onboarding wizard: an outreach campaign plus a
 * default cadence template + steps derived from the campaign's goal. The
 * deterministic logic (goal classification, cadence archetype, targeting
 * normalization) lives in `outreach-interview-core.ts`.
 */

import { db } from "../db";
import {
  outreachCampaigns,
  cadenceTemplates,
  cadenceSteps,
  type OutreachCampaign,
  type OutreachInterview,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { assembleCampaign } from "./outreach-interview-core";

export interface CreateCampaignFromInterviewParams {
  tenantDomain: string;
  marketId?: string | null;
  createdBy: string;
  name: string;
  /** The captured interview answers. */
  answers: OutreachInterview & {
    refinements?: any;
    channels?: unknown;
  };
  productId?: string | null;
  targetPersonaIds?: string[] | null;
  conferenceId?: string | null;
  eventDate?: Date | null;
  voiceProfileId?: string | null;
}

export interface CreateCampaignResult {
  campaign: OutreachCampaign;
  cadenceTemplateId: string;
}

/**
 * Create an outreach campaign + its default cadence from interview answers.
 * Runs in one transaction so a campaign always has a usable cadence.
 */
export async function createCampaignFromInterview(
  params: CreateCampaignFromInterviewParams,
): Promise<CreateCampaignResult> {
  const assembled = assembleCampaign({
    goal: params.answers.goal,
    refinements: params.answers.refinements,
    channels: params.answers.channels,
  });

  // The interview blob we persist excludes the transient refinements/channels
  // (those are normalized onto the campaign columns).
  const interview: OutreachInterview = {
    goal: params.answers.goal,
    message: params.answers.message,
    callToAction: params.answers.callToAction,
    notes: params.answers.notes,
    answers: params.answers.answers,
  };

  return db.transaction(async (tx) => {
    const [template] = await tx
      .insert(cadenceTemplates)
      .values({
        tenantDomain: params.tenantDomain,
        name: `${params.name} cadence`,
        archetype: assembled.archetype,
        anchor: assembled.cadence.anchor,
        isDefault: false,
      })
      .returning();

    if (assembled.cadence.steps.length > 0) {
      await tx.insert(cadenceSteps).values(
        assembled.cadence.steps.map((s) => ({
          templateId: template.id,
          stepNumber: s.stepNumber,
          channel: s.channel,
          dayOffset: s.dayOffset,
          businessHoursOnly: s.businessHoursOnly,
          purpose: s.purpose,
        })),
      );
    }

    const [campaign] = await tx
      .insert(outreachCampaigns)
      .values({
        tenantDomain: params.tenantDomain,
        marketId: params.marketId ?? null,
        name: params.name,
        goalType: assembled.goalType,
        salesGoal: params.answers.goal ?? null,
        interview,
        productId: params.productId ?? null,
        targetPersonaIds: params.targetPersonaIds ?? null,
        targetingFilter: assembled.targetingFilter,
        channels: assembled.channels,
        conferenceId: params.conferenceId ?? null,
        eventDate: params.eventDate ?? null,
        cadenceTemplateId: template.id,
        voiceProfileId: params.voiceProfileId ?? null,
        status: "draft",
        createdBy: params.createdBy,
      })
      .returning();

    return { campaign, cadenceTemplateId: template.id };
  });
}

/** Load a campaign scoped to the tenant. */
export async function getCampaign(
  tenantDomain: string,
  campaignId: string,
): Promise<OutreachCampaign | undefined> {
  const [row] = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, campaignId));
  if (!row || row.tenantDomain !== tenantDomain) return undefined;
  return row;
}
