// Stripe billing service — webhook processing, plan derivation, grace window
import type Stripe from "stripe";
import { storage } from "../storage";
import { getUncachableStripeClient } from "../stripeClient";
import { db } from "../db";
import { billingEvents, tenants, type Tenant } from "@shared/schema";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { sendEmail, wrapEmailContent } from "./email-service";

async function notifyAdminsOfPaymentFailure(
  tenant: Tenant,
  graceUntil: Date,
): Promise<void> {
  try {
    const users = await storage.getUsersByDomain(tenant.domain);
    const admins = users.filter(
      (u) => u.role === "Domain Admin" || u.role === "Global Admin",
    );
    if (admins.length === 0) return;
    const deadline = graceUntil.toLocaleDateString();
    const subject = `Action required: payment failed for ${tenant.name}`;
    const body = `
      <h2>Your latest payment failed</h2>
      <p>We were unable to charge the payment method on file for <strong>${tenant.name}</strong>.</p>
      <p>Please update your payment method before <strong>${deadline}</strong> to avoid losing access to paid features.</p>
      <p><a href="https://www.synozur.com/orbit" style="display:inline-block;padding:10px 16px;background:#810FFB;color:#fff;border-radius:6px;text-decoration:none;">Manage Billing</a></p>
      <p>If you have already updated your payment method, you can ignore this email.</p>
    `;
    await Promise.all(
      admins.map((a) =>
        sendEmail({
          to: a.email,
          subject,
          html: wrapEmailContent(body),
          text: `Your latest payment for ${tenant.name} failed. Please update your payment method before ${deadline} to avoid losing access.`,
        }),
      ),
    );
  } catch (err) {
    console.error("[Billing] Failed to send payment-failure email", err);
  }
}

async function getTenantById(id: string): Promise<Tenant | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0] ?? null;
}

// Stripe API 2025-08-27 moved current_period_end onto subscription items.
function getSubscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const fromSub = (sub as any).current_period_end as number | undefined;
  const fromItem = sub.items?.data?.[0]?.current_period_end as number | undefined;
  const ts = fromSub ?? fromItem;
  return ts ? new Date(ts * 1000) : null;
}

const PAYMENT_GRACE_DAYS = 7;

// Plan tiers we consider "paid" via Stripe
export const STRIPE_MANAGED_PLANS = ["pro", "enterprise", "unlimited"] as const;

// Map a Stripe Subscription to a plan tier using product metadata.
// Product metadata: { plan_tier: "pro" | "enterprise" | "unlimited" }
export async function derivePlanFromSubscription(
  sub: Stripe.Subscription,
  stripe: Stripe,
): Promise<string | null> {
  const item = sub.items?.data?.[0];
  if (!item) return null;
  const priceId = item.price.id;
  // Expand product if needed
  let product: Stripe.Product | null = null;
  const productRef = item.price.product as string | Stripe.Product;
  if (typeof productRef === "string") {
    try {
      product = await stripe.products.retrieve(productRef);
    } catch (err) {
      console.error("[Billing] Failed to retrieve product", productRef, err);
      return null;
    }
  } else if (productRef && !(productRef as any).deleted) {
    product = productRef as Stripe.Product;
  }
  if (!product) return null;
  const tier = (product.metadata?.plan_tier || product.metadata?.planTier || "")
    .toLowerCase()
    .trim();
  if (STRIPE_MANAGED_PLANS.includes(tier as any)) return tier;
  // Fallback: also check price metadata
  const priceMeta = (item.price.metadata?.plan_tier || "").toLowerCase().trim();
  if (STRIPE_MANAGED_PLANS.includes(priceMeta as any)) return priceMeta;
  console.warn(`[Billing] No plan_tier metadata on product ${product.id} / price ${priceId}`);
  return null;
}

function isActiveStatus(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

// Returns true if tenant has an active paid Stripe subscription that should
// override trial/free downgrade behavior.
export function hasActivePaidSubscription(tenant: Tenant): boolean {
  if (!tenant.stripeSubscriptionId) return false;
  if (!isActiveStatus(tenant.subscriptionStatus)) return false;
  return true;
}

// Returns true if tenant is currently inside the 7-day grace window.
export function isInPaymentGrace(tenant: Tenant): boolean {
  if (!tenant.paymentGraceUntil) return false;
  return tenant.paymentGraceUntil.getTime() > Date.now();
}

async function recordEvent(event: Stripe.Event, tenantId: string | null) {
  try {
    await db
      .insert(billingEvents)
      .values({
        id: event.id,
        type: event.type,
        tenantId: tenantId ?? null,
        stripeCustomerId: ((event.data?.object as any)?.customer as string) ?? null,
        stripeSubscriptionId:
          ((event.data?.object as any)?.subscription as string) ??
          ((event.data?.object as any)?.id?.toString().startsWith("sub_")
            ? ((event.data?.object as any).id as string)
            : null),
        payload: event as any,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error("[Billing] Failed to record event", event.id, err);
  }
}

// Returns true if the event was already processed (and should be skipped).
async function alreadyProcessed(eventId: string): Promise<boolean> {
  const rows = await db
    .select({ id: billingEvents.id })
    .from(billingEvents)
    .where(eq(billingEvents.id, eventId))
    .limit(1);
  return rows.length > 0;
}

async function findTenantByCustomerId(customerId: string): Promise<Tenant | null> {
  const rows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.stripeCustomerId, customerId))
    .limit(1);
  return rows[0] ?? null;
}

async function findTenantByDomain(domain: string): Promise<Tenant | null> {
  const t = await storage.getTenantByDomain(domain);
  return t ?? null;
}

// Resolve which Orbit tenant a Stripe customer belongs to. Falls back to the
// metadata.tenant_id we attach when creating the customer.
async function resolveTenant(
  stripe: Stripe,
  customerId: string,
): Promise<Tenant | null> {
  const local = await findTenantByCustomerId(customerId);
  if (local) return local;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ((customer as any).deleted) return null;
    const meta = (customer as Stripe.Customer).metadata || {};
    if (meta.tenant_id) {
      const t = await getTenantById(meta.tenant_id);
      if (t) return t;
    }
    if (meta.tenant_domain) {
      const t = await findTenantByDomain(meta.tenant_domain);
      if (t) return t;
    }
  } catch (err) {
    console.error("[Billing] Failed to resolve tenant from customer", customerId, err);
  }
  return null;
}

async function applySubscriptionToTenant(
  tenant: Tenant,
  sub: Stripe.Subscription,
  stripe: Stripe,
): Promise<void> {
  if (tenant.billingManagedManually) {
    console.log(
      `[Billing] Tenant ${tenant.domain} is billing_managed_manually=true; skipping plan sync`,
    );
    // Still keep stripe ids and status fresh for visibility
    await storage.updateTenant(tenant.id, {
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd: getSubscriptionPeriodEnd(sub),
      seatCount: sub.items?.data?.[0]?.quantity ?? null,
    });
    return;
  }

  const status = sub.status;
  const seatCount = sub.items?.data?.[0]?.quantity ?? null;
  const periodEnd = getSubscriptionPeriodEnd(sub);

  // Plan derivation only when subscription is in a billable/active state.
  const updates: Partial<Tenant> = {
    stripeSubscriptionId: sub.id,
    subscriptionStatus: status,
    currentPeriodEnd: periodEnd,
    seatCount,
  };

  if (status === "active" || status === "trialing") {
    const planTier = await derivePlanFromSubscription(sub, stripe);
    if (planTier) {
      updates.plan = planTier;
    }
    // Active payment clears any past grace window
    updates.paymentGraceUntil = null;
  } else if (status === "past_due" || status === "unpaid") {
    // Open grace window if not already set
    if (!tenant.paymentGraceUntil) {
      updates.paymentGraceUntil = new Date(
        Date.now() + PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000,
      );
    }
  } else if (status === "canceled" || status === "incomplete_expired") {
    // Hard downgrade to free unless tenant is on trial that hasn't expired
    if (tenant.plan !== "trial") {
      updates.plan = "free";
    }
    updates.paymentGraceUntil = null;
    updates.stripeSubscriptionId = null;
  }

  await storage.updateTenant(tenant.id, updates);
  console.log(
    `[Billing] Tenant ${tenant.domain} updated: status=${status}, plan=${updates.plan ?? tenant.plan}, seats=${seatCount}`,
  );
}

// Main webhook event dispatcher. Caller has already verified signature.
export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  if (await alreadyProcessed(event.id)) {
    console.log(`[Billing] Event ${event.id} already processed; skipping`);
    return;
  }

  const stripe = await getUncachableStripeClient();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const tenant = await resolveTenant(stripe, sub.customer as string);
      if (!tenant) {
        console.warn(`[Billing] No tenant for customer ${sub.customer} on ${event.type}`);
        await recordEvent(event, null);
        return;
      }
      // Treat .deleted as a canceled state
      if (event.type === "customer.subscription.deleted") {
        sub.status = "canceled" as Stripe.Subscription.Status;
      }
      await applySubscriptionToTenant(tenant, sub, stripe);
      await recordEvent(event, tenant.id);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const tenant = await resolveTenant(stripe, invoice.customer as string);
      if (!tenant) {
        await recordEvent(event, null);
        return;
      }
      if (!tenant.paymentGraceUntil || tenant.paymentGraceUntil.getTime() < Date.now()) {
        const graceUntil = new Date(
          Date.now() + PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000,
        );
        await storage.updateTenant(tenant.id, {
          paymentGraceUntil: graceUntil,
          subscriptionStatus: "past_due",
        });
        console.log(
          `[Billing] Tenant ${tenant.domain} entered ${PAYMENT_GRACE_DAYS}-day payment grace window`,
        );
        await notifyAdminsOfPaymentFailure(tenant, graceUntil);
      }
      await recordEvent(event, tenant.id);
      break;
    }
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const tenant = await resolveTenant(stripe, invoice.customer as string);
      if (!tenant) {
        await recordEvent(event, null);
        return;
      }
      const updates: Partial<Tenant> = { paymentGraceUntil: null };
      // Refresh subscription if invoice references one
      const subId =
        (invoice as any).subscription &&
        typeof (invoice as any).subscription === "string"
          ? ((invoice as any).subscription as string)
          : null;
      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          await applySubscriptionToTenant(tenant, sub, stripe);
        } catch (err) {
          console.error("[Billing] Failed to refresh subscription", subId, err);
        }
      }
      await storage.updateTenant(tenant.id, updates);
      await recordEvent(event, tenant.id);
      break;
    }
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;
      if (!customerId) {
        await recordEvent(event, null);
        return;
      }
      // tenant_id metadata was attached when creating the session
      let tenant: Tenant | null = null;
      const tenantId = session.metadata?.tenant_id;
      if (tenantId) {
        const t = await getTenantById(tenantId);
        tenant = t ?? null;
      }
      if (!tenant) tenant = await resolveTenant(stripe, customerId);
      if (!tenant) {
        await recordEvent(event, null);
        return;
      }
      // Persist customer id if missing
      if (!tenant.stripeCustomerId) {
        await storage.updateTenant(tenant.id, { stripeCustomerId: customerId });
      }
      const subId = session.subscription as string | null;
      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          await applySubscriptionToTenant(tenant, sub, stripe);
        } catch (err) {
          console.error("[Billing] Failed to load subscription post-checkout", subId, err);
        }
      }
      await recordEvent(event, tenant.id);
      break;
    }
    default:
      // Unhandled — record so we don't reprocess
      await recordEvent(event, null);
      break;
  }
}

// Cron sweep: downgrade tenants whose grace window has expired
export async function sweepExpiredGraceWindows(): Promise<number> {
  const now = new Date();
  const rows = await db
    .select()
    .from(tenants)
    .where(
      and(
        isNotNull(tenants.paymentGraceUntil),
        lt(tenants.paymentGraceUntil, now),
      ),
    );
  let downgraded = 0;
  for (const t of rows) {
    if (t.billingManagedManually) {
      // Clear grace marker but don't change plan
      await storage.updateTenant(t.id, { paymentGraceUntil: null });
      continue;
    }
    await storage.updateTenant(t.id, {
      plan: "free",
      paymentGraceUntil: null,
      subscriptionStatus: t.subscriptionStatus ?? "past_due",
    });
    console.log(`[Billing] Tenant ${t.domain} grace window expired; downgraded to free`);
    downgraded++;
  }
  return downgraded;
}

// Find or create a Stripe customer for the tenant.
export async function ensureStripeCustomer(tenant: Tenant, email: string): Promise<string> {
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;
  const stripe = await getUncachableStripeClient();
  const customer = await stripe.customers.create({
    email,
    name: tenant.name,
    metadata: {
      tenant_id: tenant.id,
      tenant_domain: tenant.domain,
    },
  });
  await storage.updateTenant(tenant.id, { stripeCustomerId: customer.id });
  return customer.id;
}
