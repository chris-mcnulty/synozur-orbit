/**
 * Email A/B Test support utilities.
 *
 * Provides:
 *  - resolveTokens(template, contact)  — {{field|fallback}} substitution
 *  - evaluateAbTests()                 — scheduled winner evaluation job
 */

import { db } from "../db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  generatedEmails,
  emailCampaignVariants,
  emailSends,
  marketingContacts,
  marketingAuditLog,
} from "@shared/schema";

// ─── Token resolution ────────────────────────────────────────────────────────

/**
 * Substitute {{field}} and {{field|fallback}} tokens in a template string.
 *
 * Supported token names match marketing_contacts columns:
 *   first_name, last_name, company, job_title, email, lifecycle_stage
 * Plus a synthetic "persona" token that maps lifecycle_stage to a human label.
 *
 * Example: "Hi {{first_name|there}}" → "Hi Alice" or "Hi there"
 */
export function resolveTokens(
  template: string,
  contact: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (_match, raw: string) => {
    const parts = raw.trim().split("|");
    const field = parts[0].trim();
    const fallback = parts[1]?.trim() ?? "";
    const value = contact[field];
    return value != null && value !== "" ? value : fallback;
  });
}

/** Known tokens with display labels — surfaced in the token picker UI. */
export const KNOWN_TOKENS: Array<{ token: string; label: string; example: string }> = [
  { token: "first_name", label: "First name", example: "Alice" },
  { token: "last_name", label: "Last name", example: "Smith" },
  { token: "company", label: "Company", example: "Acme Corp" },
  { token: "job_title", label: "Job title", example: "VP Marketing" },
  { token: "email", label: "Email address", example: "alice@acme.com" },
  { token: "lifecycle_stage", label: "Lifecycle stage", example: "lead" },
];

/**
 * Resolve tokens for a contact looked up by email address within a tenant.
 * Falls back gracefully to empty strings when the contact is not found.
 */
export async function resolveTokensForEmail(
  template: string,
  tenantDomain: string,
  recipientEmail: string,
): Promise<string> {
  const [contact] = await db
    .select()
    .from(marketingContacts)
    .where(
      and(
        eq(marketingContacts.tenantDomain, tenantDomain),
        eq(marketingContacts.email, recipientEmail.toLowerCase().trim()),
      ),
    );
  if (!contact) return resolveTokens(template, {});
  return resolveTokens(template, {
    first_name: contact.firstName,
    last_name: contact.lastName,
    company: contact.company,
    job_title: contact.jobTitle,
    email: contact.email,
    lifecycle_stage: contact.lifecycleStage,
  });
}

/**
 * Resolve tokens for a sample contact (used in preview mode).
 * If no sample contact is found, substitutes synthetic example values.
 */
export async function resolveTokensPreview(
  template: string,
  tenantDomain: string,
  contactId?: string | null,
): Promise<string> {
  let contact: Record<string, string | null | undefined> = {};

  if (contactId) {
    const [c] = await db
      .select()
      .from(marketingContacts)
      .where(
        and(
          eq(marketingContacts.id, contactId),
          eq(marketingContacts.tenantDomain, tenantDomain),
        ),
      );
    if (c) {
      contact = {
        first_name: c.firstName,
        last_name: c.lastName,
        company: c.company,
        job_title: c.jobTitle,
        email: c.email,
        lifecycle_stage: c.lifecycleStage,
      };
    }
  } else {
    // Use synthetic example values so the preview is readable
    contact = {
      first_name: "Alice",
      last_name: "Smith",
      company: "Acme Corp",
      job_title: "VP Marketing",
      email: "alice@acme.com",
      lifecycle_stage: "lead",
    };
  }

  return resolveTokens(template, contact);
}

// ─── Winner evaluation ───────────────────────────────────────────────────────

interface AbTestResult {
  emailId: string;
  winner: "A" | "B" | "tie";
  variantAOpens: number;
  variantBOpens: number;
  variantAClicks: number;
  variantBClicks: number;
  variantARecipients: number;
  variantBRecipients: number;
}

let abWorkerInFlight = false;

/**
 * Tick function for the A/B test winner evaluation worker.
 * Runs on the scheduled-jobs interval. Checks emails whose A/B test window
 * has elapsed, declares a winner, and queues the holdback send.
 */
export async function tickAbTestEvaluationWorker(): Promise<{
  evaluated: number;
  errors: number;
}> {
  if (abWorkerInFlight) return { evaluated: 0, errors: 0 };
  abWorkerInFlight = true;
  let evaluated = 0;
  let errors = 0;

  try {
    // Find in-flight A/B test runs: look for ab_holdback rows whose run_id
    // has not had a winner declared yet. Each holdback row represents exactly
    // one test run, so iterating over them avoids the multi-run confusion that
    // arises from querying by email_id alone.
    const pendingHoldbacks = await db
      .select({
        holdback: emailSends,
        email: generatedEmails,
      })
      .from(emailSends)
      .innerJoin(generatedEmails, eq(generatedEmails.id, emailSends.generatedEmailId))
      .where(
        and(
          eq(emailSends.isAbHoldback, true),
          eq(emailSends.status, "ab_holdback"),
          eq(generatedEmails.abTestEnabled, true),
          sql`${emailSends.abTestRunId} IS NOT NULL`,
        ),
      );

    for (const { holdback, email } of pendingHoldbacks) {
      try {
        const runId = holdback.abTestRunId;
        if (!runId) continue;

        // Find A and B sends that belong to THIS run (scoped by run ID)
        const sends = await db
          .select()
          .from(emailSends)
          .where(
            and(
              eq(emailSends.abTestRunId, runId),
              eq(emailSends.isAbHoldback, false),
              sql`${emailSends.abVariantLabel} IS NOT NULL`,
              inArray(emailSends.status, ["sent", "partial", "completed"]),
            ),
          );

        const sendA = sends.find(s => s.abVariantLabel === "A");
        const sendB = sends.find(s => s.abVariantLabel === "B");
        if (!sendA || !sendB) continue;

        // Check evaluation window
        const completedAtA = sendA.completedAt ?? sendA.startedAt;
        const completedAtB = sendB.completedAt ?? sendB.startedAt;
        if (!completedAtA || !completedAtB) continue;
        const latestCompleted = Math.max(completedAtA.getTime(), completedAtB.getTime());
        const evaluationMs = (email.abEvaluationHours ?? 24) * 60 * 60 * 1000;
        if (Date.now() < latestCompleted + evaluationMs) continue;

        // Compute rates
        const aRecipients = Math.max(sendA.recipientCount, 1);
        const bRecipients = Math.max(sendB.recipientCount, 1);
        const aOpenRate = sendA.openCount / aRecipients;
        const bOpenRate = sendB.openCount / bRecipients;
        const aClickRate = sendA.clickCount / aRecipients;
        const bClickRate = sendB.clickCount / bRecipients;

        const metric = email.abWinnerMetric ?? "open_rate";
        const aScore = metric === "click_rate" ? aClickRate : aOpenRate;
        const bScore = metric === "click_rate" ? bClickRate : bOpenRate;

        const winnerLabel: "A" | "B" | "tie" =
          aScore > bScore ? "A" : bScore > aScore ? "B" : "tie";
        const effectiveWinner = winnerLabel === "tie" ? "A" : winnerLabel;

        // ── Atomic holdback release (per-run CAS) ─────────────────────────
        // The holdback row's status is the source of truth for this run.
        // Flip it atomically: if another worker already released it, this
        // UPDATE returns 0 rows and we skip — no cross-run interference even
        // if the email is re-dispatched and the shared winner fields are reset.
        const released = await db
          .update(emailSends)
          .set({
            status: "queued",
            scheduledAt: new Date(),
            abVariantLabel: effectiveWinner,
          })
          .where(
            and(
              eq(emailSends.id, holdback.id),
              eq(emailSends.status, "ab_holdback"),   // CAS: only flip once
            ),
          )
          .returning({ id: emailSends.id });
        if (released.length === 0) continue; // already released by another worker

        // Best-effort: write winner label to the email for UI display. This is
        // not relied on for correctness — the holdback CAS above is the atomic
        // guard. A new dispatch resets these fields; that's fine because its
        // own holdback row has a different id and will be flipped independently.
        await db
          .update(generatedEmails)
          .set({
            abWinnerVariantLabel: effectiveWinner,
            abWinnerDeclaredAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(generatedEmails.id, email.id));

        await db.insert(marketingAuditLog).values({
          tenantDomain: email.tenantDomain,
          marketId: email.marketId ?? null,
          action: "ab_test_winner_declared",
          entityType: "generated_email",
          entityId: email.id,
          status: "ok",
          message: `A/B test winner: variant ${effectiveWinner} (${metric}: A=${(aScore * 100).toFixed(1)}% vs B=${(bScore * 100).toFixed(1)}%)`,
          details: {
            winnerLabel: effectiveWinner,
            metric,
            aOpenRate,
            bOpenRate,
            aClickRate,
            bClickRate,
            aRecipients,
            bRecipients,
            holdbackQueued: true,
          },
        });

        evaluated += 1;
      } catch (err: any) {
        console.error(`[AB Test Worker] Failed to evaluate email ${email.id}:`, err?.message);
        errors += 1;
      }
    }
  } finally {
    abWorkerInFlight = false;
  }

  return { evaluated, errors };
}
