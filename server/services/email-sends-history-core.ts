/**
 * Pure helpers for the Sends history list (GET /api/email-sends).
 *
 * Externally-sent newsletters (marked sent via HubSpot etc.) live on
 * generated_emails with the explicit sent_externally provenance flag and no
 * email_sends delivery row. These helpers project them into the same shape
 * the Sends UI renders for SendGrid sends and merge the two histories.
 */

export interface ExternalSentEmail {
  id: string;
  subject: string;
  sentAt: Date | null;
  createdAt: Date | null;
  hubspotEmailId: string | null;
  hubspotEmailUrl: string | null;
}

export interface SendHistoryRow {
  id: string;
  emailId: string | null;
  subject: string | null;
  status: string;
  createdAt: Date | string | null;
  [key: string]: unknown;
}

/** Project an externally-sent generated email into the Sends-row shape. */
export function buildExternalSendRow(e: ExternalSentEmail): SendHistoryRow {
  return {
    id: `external-${e.id}`,
    emailId: e.id,
    subject: e.subject,
    listId: null,
    testRecipient: null,
    status: "sent_external",
    scheduledAt: null,
    totalRecipients: 0,
    sentCount: 0,
    failedCount: 0,
    bounceCount: 0,
    unsubscribeCount: 0,
    spamCount: 0,
    openCount: 0,
    clickCount: 0,
    deliveredCount: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: e.sentAt,
    createdAt: e.sentAt ?? e.createdAt,
    isExternal: true,
    hubspotEmailId: e.hubspotEmailId,
    hubspotEmailUrl: e.hubspotEmailUrl,
  };
}

/** Merge direct + external send rows, newest first, capped at `limit`. */
export function mergeSendHistory(
  direct: SendHistoryRow[],
  external: SendHistoryRow[],
  limit = 100,
): SendHistoryRow[] {
  return [...direct, ...external]
    .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
    .slice(0, limit);
}
