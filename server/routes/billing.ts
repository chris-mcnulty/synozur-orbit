// Stripe billing routes — Checkout, Customer Portal, Webhook
import type { Express, Request, Response } from "express";
import express from "express";
import { storage } from "../storage";
import {
  getUncachableStripeClient,
  getStripePublishableKey,
  isStripeConfigured,
} from "../stripeClient";
import {
  ensureStripeCustomer,
  processStripeEvent,
  hasActivePaidSubscription,
  isInPaymentGrace,
} from "../services/billing-service";

async function requireDomainAdmin(
  req: Request,
  res: Response,
): Promise<{ user: any; tenant: any } | null> {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const user = await storage.getUser(userId);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (user.role !== "Domain Admin" && user.role !== "Global Admin") {
    res.status(403).json({ error: "Domain Admin access required" });
    return null;
  }
  const domain = user.email.split("@")[1]?.toLowerCase();
  const tenant = domain ? await storage.getTenantByDomain(domain) : null;
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return null;
  }
  return { user, tenant };
}

function appBaseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

// Self-serve plan tiers. Anything else (enterprise, unlimited) must go through
// sales — checkout will reject those price IDs.
const SELF_SERVE_TIERS = new Set(["pro"]);

async function validateSelfServePriceId(priceId: string): Promise<{
  ok: boolean;
  tier?: string;
  error?: string;
}> {
  try {
    const stripe = await getUncachableStripeClient();
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    if (!price.active) return { ok: false, error: "Price is not active" };
    const product = price.product as any;
    if (!product || product.deleted) {
      return { ok: false, error: "Price has no active product" };
    }
    const tier = (
      product.metadata?.plan_tier ||
      product.metadata?.planTier ||
      price.metadata?.plan_tier ||
      ""
    )
      .toString()
      .toLowerCase()
      .trim();
    if (!SELF_SERVE_TIERS.has(tier)) {
      return {
        ok: false,
        error:
          "This plan is not available for self-serve checkout. Please contact sales.",
      };
    }
    return { ok: true, tier };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to validate price" };
  }
}

async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  if (!(await isStripeConfigured())) {
    res.status(400).send("Billing not configured");
    return;
  }
  const sig = req.headers["stripe-signature"] as string | undefined;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    console.error("[Stripe Webhook] Missing signature or STRIPE_WEBHOOK_SECRET");
    res.status(400).send("Webhook misconfigured");
    return;
  }
  let event;
  try {
    const stripe = await getUncachableStripeClient();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }
  try {
    await processStripeEvent(event);
    res.json({ received: true });
  } catch (err: any) {
    console.error("[Stripe Webhook] Processing error", event.id, err);
    // Return 5xx so Stripe retries with its own exponential backoff.
    res.status(500).json({ error: "processing_failed", message: err.message });
  }
}

export function registerBillingRoutes(app: Express): void {
  // Webhook — primary path per spec, plus legacy alias.
  // Both paths are excluded from express.json in server/index.ts.
  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    handleStripeWebhook,
  );
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    handleStripeWebhook,
  );

  // Public config (publishable key)
  app.get("/api/billing/config", async (_req, res) => {
    try {
      const configured = await isStripeConfigured();
      if (!configured) return res.json({ configured: false });
      const publishableKey = await getStripePublishableKey();
      res.json({ configured: true, publishableKey });
    } catch (err) {
      res.json({ configured: false });
    }
  });

  // Tenant billing snapshot — adds seats used so callers can render seat usage
  app.get("/api/billing/status", async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    const domain = user.email.split("@")[1]?.toLowerCase();
    const tenant = domain ? await storage.getTenantByDomain(domain) : null;
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    let seatsUsed: number | null = null;
    try {
      const tenantUsers = await storage.getUsersByDomain(domain!);
      seatsUsed = tenantUsers.length;
    } catch {
      seatsUsed = null;
    }

    res.json({
      plan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus ?? null,
      stripeCustomerId: tenant.stripeCustomerId ?? null,
      stripeSubscriptionId: tenant.stripeSubscriptionId ?? null,
      currentPeriodEnd: tenant.currentPeriodEnd ?? null,
      seatCount: tenant.seatCount ?? null,
      seatsUsed,
      paymentGraceUntil: tenant.paymentGraceUntil ?? null,
      inPaymentGrace: isInPaymentGrace(tenant),
      hasPaidSubscription: hasActivePaidSubscription(tenant),
      billingManagedManually: tenant.billingManagedManually ?? false,
      selfServeEnabled: tenant.billingManagedManually !== true,
    });
  });

  // Invoice history + payment method summary (read-only). Domain-Admin only.
  app.get("/api/billing/invoices", async (req, res) => {
    if (!(await isStripeConfigured())) {
      return res.status(503).json({ error: "Billing not configured" });
    }
    const ctx = await requireDomainAdmin(req, res);
    if (!ctx) return;
    const { tenant } = ctx;
    if (!tenant.stripeCustomerId) return res.json({ invoices: [], paymentMethod: null });
    try {
      const stripe = await getUncachableStripeClient();
      const list = await stripe.invoices.list({
        customer: tenant.stripeCustomerId,
        limit: 12,
      });
      const invoices = list.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amountDue: inv.amount_due,
        amountPaid: inv.amount_paid,
        currency: inv.currency,
        created: inv.created ? inv.created * 1000 : null,
        hostedInvoiceUrl: inv.hosted_invoice_url,
        invoicePdf: inv.invoice_pdf,
        periodStart: inv.period_start ? inv.period_start * 1000 : null,
        periodEnd: inv.period_end ? inv.period_end * 1000 : null,
      }));

      let paymentMethod: any = null;
      try {
        const customer = await stripe.customers.retrieve(tenant.stripeCustomerId);
        const defaultPmId =
          (customer as any).invoice_settings?.default_payment_method ?? null;
        if (defaultPmId && typeof defaultPmId === "string") {
          const pm = await stripe.paymentMethods.retrieve(defaultPmId);
          paymentMethod = {
            type: pm.type,
            brand: pm.card?.brand ?? null,
            last4: pm.card?.last4 ?? null,
            expMonth: pm.card?.exp_month ?? null,
            expYear: pm.card?.exp_year ?? null,
          };
        }
      } catch (err) {
        console.warn("[Billing] failed to load default payment method", err);
      }

      res.json({ invoices, paymentMethod });
    } catch (err: any) {
      console.error("[Billing] invoices error", err);
      res.status(500).json({ error: err.message || "Failed to load invoices" });
    }
  });

  // Create Checkout Session — Pro tier only, server-validated allowlist
  app.post("/api/billing/checkout-session", async (req, res) => {
    if (!(await isStripeConfigured())) {
      return res.status(503).json({ error: "Billing not configured" });
    }
    const ctx = await requireDomainAdmin(req, res);
    if (!ctx) return;
    const { user, tenant } = ctx;

    if (tenant.billingManagedManually) {
      return res.status(400).json({
        error: "Billing is managed manually for this tenant. Please contact support.",
      });
    }

    const requestedPriceId =
      (req.body?.priceId as string) || process.env.STRIPE_PRO_PRICE_ID;
    // Default seat quantity to the tenant's current user count so existing
    // teams are properly provisioned. Caller may override with body.seats.
    let seats = parseInt(req.body?.seats as string, 10);
    if (!Number.isFinite(seats) || seats < 1) {
      try {
        const existingUsers = await storage.getUsersByDomain(tenant.domain);
        seats = Math.max(1, existingUsers.length || 1);
      } catch {
        seats = 1;
      }
    }
    if (!requestedPriceId) {
      return res
        .status(400)
        .json({ error: "Missing priceId. Configure STRIPE_PRO_PRICE_ID or pass priceId." });
    }

    // Server-side allowlist: only Pro-tier prices are accepted via self-serve.
    const validation = await validateSelfServePriceId(requestedPriceId);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const stripe = await getUncachableStripeClient();
      const customerId = await ensureStripeCustomer(tenant, user.email);
      const baseUrl = appBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: requestedPriceId, quantity: seats }],
        success_url: `${baseUrl}/app/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/app/settings?billing=cancelled`,
        allow_promotion_codes: true,
        client_reference_id: tenant.id,
        metadata: {
          tenant_id: tenant.id,
          tenant_domain: tenant.domain,
        },
        subscription_data: {
          metadata: {
            tenant_id: tenant.id,
            tenant_domain: tenant.domain,
          },
        },
      });
      res.json({ url: session.url, id: session.id });
    } catch (err: any) {
      console.error("[Billing] checkout-session error", err);
      res.status(500).json({ error: err.message || "Failed to create checkout session" });
    }
  });

  // Create Customer Portal Session — payment method, invoices, cancel, seat changes
  app.post("/api/billing/portal-session", async (req, res) => {
    if (!(await isStripeConfigured())) {
      return res.status(503).json({ error: "Billing not configured" });
    }
    const ctx = await requireDomainAdmin(req, res);
    if (!ctx) return;
    const { user, tenant } = ctx;

    if (tenant.billingManagedManually) {
      return res
        .status(400)
        .json({ error: "Billing is managed manually for this tenant." });
    }

    try {
      const stripe = await getUncachableStripeClient();
      const customerId = await ensureStripeCustomer(tenant, user.email);
      const baseUrl = appBaseUrl(req);
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/app/settings?billing=portal-return`,
      });
      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[Billing] portal-session error", err);
      res.status(500).json({ error: err.message || "Failed to create portal session" });
    }
  });

  // Update subscription seat quantity (proration enabled). Domain-Admin only.
  app.post("/api/billing/update-seats", async (req, res) => {
    if (!(await isStripeConfigured())) {
      return res.status(503).json({ error: "Billing not configured" });
    }
    const ctx = await requireDomainAdmin(req, res);
    if (!ctx) return;
    const { tenant } = ctx;
    if (tenant.billingManagedManually) {
      return res.status(400).json({ error: "Billing is managed manually." });
    }
    if (!tenant.stripeSubscriptionId) {
      return res.status(400).json({ error: "No active subscription" });
    }
    const seats = parseInt(req.body?.seats as string, 10);
    if (!Number.isFinite(seats) || seats < 1) {
      return res.status(400).json({ error: "seats must be a positive integer" });
    }
    try {
      const stripe = await getUncachableStripeClient();
      const sub = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
      const item = sub.items.data[0];
      if (!item) return res.status(400).json({ error: "Subscription has no items" });
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, quantity: seats }],
        proration_behavior: "create_prorations",
      });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[Billing] update-seats error", err);
      res.status(500).json({ error: err.message || "Failed to update seats" });
    }
  });

  // Public listing of available self-serve plans (Pro tier only)
  app.get("/api/billing/plans", async (_req, res) => {
    if (!(await isStripeConfigured())) {
      return res.status(503).json({ error: "Billing not configured" });
    }
    try {
      const stripe = await getUncachableStripeClient();
      const prices = await stripe.prices.list({
        active: true,
        expand: ["data.product"],
        limit: 50,
      });
      const plans = prices.data
        .filter((p) => {
          const prod = p.product as any;
          if (!prod || prod.deleted) return false;
          const tier = (prod.metadata?.plan_tier || prod.metadata?.planTier || "")
            .toLowerCase();
          return SELF_SERVE_TIERS.has(tier);
        })
        .map((p) => {
          const prod = p.product as any;
          return {
            priceId: p.id,
            productId: prod.id,
            name: prod.name,
            description: prod.description,
            tier: (prod.metadata?.plan_tier || prod.metadata?.planTier || "")
              .toLowerCase(),
            interval: p.recurring?.interval ?? null,
            unitAmount: p.unit_amount,
            currency: p.currency,
          };
        });
      res.json({ plans });
    } catch (err: any) {
      console.error("[Billing] list plans error", err);
      res.status(500).json({ error: err.message || "Failed to list plans" });
    }
  });
}
