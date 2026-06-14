/**
 * Outlook Draft service.
 *
 * Creates an approved outreach touch as a DRAFT in the seller's own Outlook
 * mailbox via their delegated Microsoft Graph token (the same per-user token
 * store used for Planner sync). The human then reviews and clicks Send in
 * Outlook — Orbit never auto-sends. Requires the seller to have granted
 * `Mail.ReadWrite`; if the token is missing or lacks the scope, the caller
 * gets a clear, actionable error.
 */

import { getValidGraphToken } from "./planner-graph-client";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface CreateOutlookDraftParams {
  userId: string;
  subject: string;
  body: string;
  toEmail?: string | null;
  /** Graph body content type. Defaults to "Text" (plain text). */
  contentType?: "Text" | "HTML";
}

export interface CreateOutlookDraftResult {
  draftId: string;
  webLink?: string;
}

export class OutlookDraftError extends Error {
  constructor(message: string, readonly code: "no_consent" | "forbidden" | "graph_error") {
    super(message);
    this.name = "OutlookDraftError";
  }
}

/**
 * Create a draft message in the user's mailbox. POSTing to /me/messages creates
 * a draft (not sent). Returns the Graph message id so the touch can link to it.
 */
export async function createOutlookDraft(params: CreateOutlookDraftParams): Promise<CreateOutlookDraftResult> {
  const token = await getValidGraphToken(params.userId);
  if (!token) {
    throw new OutlookDraftError(
      "Your Microsoft mailbox isn't connected (or consent expired). Connect it in outreach settings to create drafts.",
      "no_consent",
    );
  }

  const message: Record<string, unknown> = {
    subject: params.subject,
    body: {
      contentType: params.contentType ?? "Text",
      content: params.body,
    },
  };
  if (params.toEmail) {
    message.toRecipients = [{ emailAddress: { address: params.toEmail } }];
  }

  const res = await fetch(`${GRAPH_BASE}/me/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (res.status === 403) {
    throw new OutlookDraftError(
      "Orbit can't create drafts in your mailbox — the Mail.ReadWrite permission wasn't granted. Reconnect your mailbox to grant it.",
      "forbidden",
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new OutlookDraftError(`Graph error creating draft (${res.status}): ${detail.slice(0, 300)}`, "graph_error");
  }

  const data = (await res.json()) as { id: string; webLink?: string };
  return { draftId: data.id, webLink: data.webLink };
}
