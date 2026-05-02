/**
 * Slack Block Kit + Teams MessageCard payload builders for webhook deliveries.
 */

import type { WebhookEventCategory } from "@shared/schema";

export interface WebhookPayload {
  category: WebhookEventCategory;
  title: string;
  summary: string;
  /** Optional bullet list rendered as plain text under the summary. */
  bullets?: string[];
  /** Optional key/value facts table rendered in both Slack and Teams. */
  facts?: { label: string; value: string }[];
  /** Optional link button at the bottom of the message. */
  link?: { label: string; url: string };
  /** Hex color for Teams card accent (and Slack attachment, when supported). */
  color?: string;
}

const DEFAULT_COLOR = "#810FFB";

function truncate(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

// ---------------------------------------------------------------------------
// Slack Block Kit
// https://api.slack.com/block-kit
// ---------------------------------------------------------------------------

export function buildSlackPayload(p: WebhookPayload): Record<string, unknown> {
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: truncate(p.title, 150), emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: truncate(p.summary, 2900) },
    },
  ];

  if (p.bullets && p.bullets.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: p.bullets
          .slice(0, 10)
          .map((b) => `• ${truncate(b, 250)}`)
          .join("\n"),
      },
    });
  }

  if (p.facts && p.facts.length > 0) {
    blocks.push({
      type: "section",
      fields: p.facts.slice(0, 10).map((f) => ({
        type: "mrkdwn",
        text: `*${truncate(f.label, 80)}*\n${truncate(f.value, 300)}`,
      })),
    });
  }

  if (p.link) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: truncate(p.link.label, 75), emoji: true },
          url: p.link.url,
          style: "primary",
        },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Orbit • ${p.category.replace(/_/g, " ")}`,
      },
    ],
  });

  return { text: truncate(p.title, 150), blocks };
}

// ---------------------------------------------------------------------------
// Microsoft Teams MessageCard (legacy connector format — works with all
// Incoming Webhook connectors including the new "Workflows" channel).
// https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
// ---------------------------------------------------------------------------

export function buildTeamsPayload(p: WebhookPayload): Record<string, unknown> {
  const themeColor = (p.color || DEFAULT_COLOR).replace(/^#/, "");
  const sections: Record<string, unknown>[] = [
    {
      activityTitle: truncate(p.title, 200),
      text: truncate(p.summary, 4000),
      markdown: true,
    },
  ];

  if (p.bullets && p.bullets.length > 0) {
    sections.push({
      text: p.bullets.slice(0, 10).map((b) => `- ${truncate(b, 250)}`).join("\n\n"),
      markdown: true,
    });
  }

  if (p.facts && p.facts.length > 0) {
    sections.push({
      facts: p.facts.slice(0, 10).map((f) => ({
        name: truncate(f.label, 80),
        value: truncate(f.value, 300),
      })),
    });
  }

  const card: Record<string, unknown> = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor,
    summary: truncate(p.title, 200),
    title: truncate(p.title, 200),
    sections,
  };

  if (p.link) {
    card.potentialAction = [
      {
        "@type": "OpenUri",
        name: truncate(p.link.label, 75),
        targets: [{ os: "default", uri: p.link.url }],
      },
    ];
  }

  return card;
}

// ---------------------------------------------------------------------------
// Convenience builders for the wired event categories
// ---------------------------------------------------------------------------

export function buildCompetitorChangePayload(opts: {
  competitorName: string;
  significance: "high" | "medium" | "low";
  summary: string;
  link?: string;
}): WebhookPayload {
  const sigColor = opts.significance === "high" ? "#E60CB3" : opts.significance === "medium" ? "#F59E0B" : "#6B7280";
  return {
    category: "competitor_change",
    title: `${opts.competitorName} — ${opts.significance} significance change`,
    summary: opts.summary,
    color: sigColor,
    link: opts.link ? { label: "View competitor", url: opts.link } : undefined,
  };
}

export function buildBriefingReadyPayload(opts: {
  tenantName: string;
  periodLabel?: string;
  executiveSummary: string;
  actionItemCount: number;
  riskAlertCount: number;
  link?: string;
}): WebhookPayload {
  return {
    category: "briefing_ready",
    title: `New intelligence briefing for ${opts.tenantName}`,
    summary: truncate(opts.executiveSummary, 1500),
    facts: [
      ...(opts.periodLabel ? [{ label: "Period", value: opts.periodLabel }] : []),
      { label: "Action items", value: String(opts.actionItemCount) },
      { label: "Risk alerts", value: String(opts.riskAlertCount) },
    ],
    link: opts.link ? { label: "Open briefing", url: opts.link } : undefined,
    color: "#810FFB",
  };
}

export function buildWeeklyDigestPayload(opts: {
  tenantName: string;
  activityCount: number;
  topActivities: { competitorName: string; description: string }[];
  link?: string;
}): WebhookPayload {
  return {
    category: "weekly_digest",
    title: `Weekly intelligence digest — ${opts.tenantName}`,
    summary: `${opts.activityCount} competitor activit${opts.activityCount === 1 ? "y" : "ies"} this week.`,
    bullets: opts.topActivities
      .slice(0, 5)
      .map((a) => `*${a.competitorName}* — ${a.description}`),
    link: opts.link ? { label: "Open Orbit", url: opts.link } : undefined,
    color: "#10B981",
  };
}

export function buildJobFailedPayload(opts: {
  jobType: string;
  targetName?: string;
  error: string;
  attempts: number;
  link?: string;
}): WebhookPayload {
  return {
    category: "job_failed",
    title: `Job failed: ${opts.jobType}${opts.targetName ? ` — ${opts.targetName}` : ""}`,
    summary: opts.error,
    facts: [
      { label: "Type", value: opts.jobType },
      ...(opts.targetName ? [{ label: "Target", value: opts.targetName }] : []),
      { label: "Attempts", value: String(opts.attempts) },
    ],
    link: opts.link ? { label: "Open Orbit", url: opts.link } : undefined,
    color: "#DC2626",
  };
}
