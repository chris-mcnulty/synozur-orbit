import { and, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { campaigns, type Campaign, type Conference, type OutreachCampaign } from "@shared/schema";
import { meetingBriefSchema, type MeetingBrief } from "@shared/conference-meetings";

export function buildConferenceOutreachContext(
  event: Pick<Conference, "thematicBrief" | "description">,
  outreach: Pick<OutreachCampaign, "salesGoal" | "interview" | "targetingFilter" | "meetingBrief">,
  promotion?: Pick<Campaign, "name" | "goal" | "objective" | "thematicBrief" | "description"> | null,
) {
  const sourceContext = {
    eventBrief: event.thematicBrief?.trim() ?? "",
    eventDescription: event.description?.trim() ?? "",
    eventGoals: [promotion?.objective, promotion?.goal].filter(Boolean).join("\n"),
    campaignBrief: [
      promotion?.thematicBrief, promotion?.description,
      outreach.interview?.message, outreach.interview?.notes,
      ...(outreach.interview?.answers ?? []).map(answer => `${answer.question}: ${answer.answer}`),
    ].filter(Boolean).join("\n\n"),
    campaignGoal: (outreach.salesGoal || outreach.interview?.goal || "").trim(),
    sourceCampaignName: promotion?.name ?? null,
  };
  // Suggestions are not persistence or authorization: the saved enabled flag
  // still controls the reviewed meeting workflow.
  const suggestedBrief: MeetingBrief = meetingBriefSchema.parse({
    goals: [sourceContext.campaignGoal, sourceContext.eventGoals].filter(Boolean).join("\n").slice(0, 4000),
    targetAccounts: (outreach.targetingFilter?.namedAccounts ?? []).join("\n").slice(0, 4000),
  });
  const saved = outreach.meetingBrief;
  const effectiveBrief: MeetingBrief | null = saved ? {
    ...saved,
    goals: saved.goals.trim() ? saved.goals : suggestedBrief.goals,
    targetAccounts: saved.targetAccounts.trim() ? saved.targetAccounts : suggestedBrief.targetAccounts,
  } : null;
  return { sourceContext, suggestedBrief, effectiveBrief };
}

export async function loadConferenceOutreachContext(
  tenantDomain: string, event: Conference, outreach: OutreachCampaign,
) {
  const [promotion] = event.campaignId ? await db.select().from(campaigns).where(and(
    eq(campaigns.id, event.campaignId), eq(campaigns.tenantDomain, tenantDomain), ne(campaigns.status, "deleted"),
  )) : [];
  const expectedMarket = outreach.marketId ?? event.marketId;
  const accessiblePromotion = promotion && (!expectedMarket || !promotion.marketId || promotion.marketId === expectedMarket) ? promotion : null;
  return buildConferenceOutreachContext(event, outreach, accessiblePromotion);
}
