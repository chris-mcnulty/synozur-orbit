import { createHmac, timingSafeEqual } from "crypto";
import type { ThreadLocation } from "@shared/email-thread";
import { EmailThreadError } from "./email-thread-parser";

export type ThreadReviewScope = { tenantDomain: string; marketId: string; userId: string; campaignId: string };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function sign(kind: string, scope: ThreadReviewScope, data: unknown) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new EmailThreadError("Meeting location review is unavailable. Please ask an administrator to configure the session secret.", 503);
  return createHmac("sha256", secret).update(canonical({ purpose: `email-thread-${kind}`, scope, data })).digest("hex");
}
function matches(actual: string, expected: string) {
  return /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
export function signThreadLocation(scope: ThreadReviewScope, suggestion: ThreadLocation) {
  return sign("evidence", scope, suggestion);
}
export function signThreadMeetingReview(scope: ThreadReviewScope, prospectId: string, conferenceId: string, meeting: unknown, expiresAt: number) {
  return sign("review", scope, { prospectId, conferenceId, meeting, expiresAt });
}
export function verifyThreadLocation(scope: ThreadReviewScope, suggestion: ThreadLocation, evidenceToken: string, reviewToken: string, prospectId: string, conferenceId: string, meeting: unknown, expiresAt: number) {
  if (suggestion.status !== "current" || !matches(evidenceToken, signThreadLocation(scope, suggestion))) {
    throw new EmailThreadError("The location evidence is invalid. Analyze the thread again.", 409);
  }
  if (expiresAt <= Date.now() || !matches(reviewToken, signThreadMeetingReview(scope, prospectId, conferenceId, meeting, expiresAt))) {
    throw new EmailThreadError("The meeting review is stale. Refresh current details and review the location again. Nothing was saved.", 409);
  }
}
