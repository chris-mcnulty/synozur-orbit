import { storage } from "../storage";
import { createNotification } from "./notification-service";
import { sendCompetitorAlertEmail } from "./email-service";
import { isFeatureEnabledAsync } from "./plan-policy";

type Significance = "high" | "medium" | "low";

const THRESHOLD_MAP: Record<string, Significance[]> = {
  high: ["high"],
  medium: ["high", "medium"],
  all: ["high", "medium", "low"],
};

function meetsThreshold(userThreshold: string, changeSignificance: Significance): boolean {
  const accepted = THRESHOLD_MAP[userThreshold] || THRESHOLD_MAP.high;
  return accepted.includes(changeSignificance);
}

export interface CompetitorChangeEvent {
  competitorId: string;
  competitorName: string;
  summary: string;
  significance: Significance;
  tenantDomain: string;
}

export async function dispatchCompetitorAlerts(event: CompetitorChangeEvent): Promise<void> {
  try {
    const tenant = await storage.getTenantByDomain(event.tenantDomain);
    if (!tenant) return;

    const featureEnabled = await isFeatureEnabledAsync(tenant.plan, "competitorAlerts");
    if (!featureEnabled) return;

    const users = await storage.getUsersByDomain(event.tenantDomain);

    const eligibleUsers = users.filter(
      u => u.alertsEnabled && meetsThreshold(u.alertThreshold || "high", event.significance)
    );

    if (eligibleUsers.length === 0) return;

    const baseUrl = process.env.BASE_URL
      ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://orbit.synozur.com");

    await Promise.allSettled(
      eligibleUsers.map(async (user) => {
        try {
          await createNotification({
            userId: user.id,
            tenantDomain: event.tenantDomain,
            type: "competitor_change",
            title: `${event.competitorName} — ${event.significance} significance change`,
            message: event.summary,
            link: `/app/competitors/${event.competitorId}`,
            readAt: null,
          });
        } catch (err) {
          console.error(`[AlertDispatch] In-app notification failed for user ${user.id}:`, err);
        }

        if (user.alertEmailEnabled) {
          try {
            await sendCompetitorAlertEmail({
              to: user.email,
              userName: user.name,
              competitorName: event.competitorName,
              competitorId: event.competitorId,
              summary: event.summary,
              significance: event.significance,
              baseUrl,
            });
          } catch (err) {
            console.error(`[AlertDispatch] Email alert failed for user ${user.id}:`, err);
          }
        }
      })
    );

    console.log(
      `[AlertDispatch] Dispatched alerts for "${event.competitorName}" to ${eligibleUsers.length} user(s) in ${event.tenantDomain}`
    );
  } catch (err) {
    console.error("[AlertDispatch] Failed to dispatch alerts:", err);
  }
}
