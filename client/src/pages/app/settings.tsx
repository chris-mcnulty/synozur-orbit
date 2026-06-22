import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreditCard, Users, Palette, UserPlus, Trash2, Shield, Loader2, Lock, UserCog, Bell, Send, Zap, Webhook, Plus, Edit, MessageSquare, Plug, Type, Upload, X } from "lucide-react";
import { Ga4IntegrationCard } from "@/components/Ga4IntegrationCard";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";
import { toast } from "sonner";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

interface TenantInvite {
  id: string;
  email: string;
  invitedRole: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface TenantSettings {
  id: string;
  domain: string;
  name: string;
  plan: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  monitoringFrequency: string;
  competitorLimit: number;
  analysisLimit: number;
  userCount: number;
  entraTenantId: string | null;
  entraEnabled: boolean;
  allowedAuthProviders?: string[] | null;
}

interface ConsultantGrant {
  id: string;
  userId: string;
  tenantId: string;
  status: string;
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
  consultantEmail?: string;
  consultantName?: string;
  grantedByName?: string;
}

interface TenantFont {
  id: string;
  tenantDomain: string;
  name: string;
  fontFamily: string | null;
  fontWeight: string | null;
  fontStyle: string | null;
  fontUsage: string;
  fileUrl: string;
  fileType: string | null;
  fileSize: number | null;
  sortOrder: number;
  createdAt: string;
}

const FONT_USAGE_LABELS: Record<string, string> = {
  heading: "Heading",
  body: "Body",
  accent: "Accent",
  display: "Display",
  mono: "Monospace",
};

const FONT_WEIGHT_OPTIONS = [
  { value: "100", label: "100 — Thin" },
  { value: "200", label: "200 — Extra Light" },
  { value: "300", label: "300 — Light" },
  { value: "400", label: "400 — Regular" },
  { value: "500", label: "500 — Medium" },
  { value: "600", label: "600 — Semi Bold" },
  { value: "700", label: "700 — Bold" },
  { value: "800", label: "800 — Extra Bold" },
  { value: "900", label: "900 — Black" },
];

// Billing actions inside the Plan & Usage card.
// Domain Admin can launch Stripe Checkout (Pro upgrade) or Customer Portal.
function BillingActions() {
  return (
    <div className="text-sm text-muted-foreground" data-testid="billing-managed-manually">
      Plan management is handled directly by the Synozur team. Contact{" "}
      <a className="text-primary hover:underline" href="mailto:contactus@synozur.com">
        contactus@synozur.com
      </a>{" "}
      for plan changes or questions.
    </div>
  );
}

function BillingActions_STRIPE_DISABLED() {
  const [busy, setBusy] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");

  const { data: tenantInfo } = useQuery<any>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch tenant info");
      return r.json();
    },
  });

  const { data: status } = useQuery<any>({
    queryKey: ["/api/billing/status"],
    queryFn: async () => {
      const r = await fetch("/api/billing/status", { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
  });

  const { data: plansData } = useQuery<{ plans: any[] }>({
    queryKey: ["/api/billing/plans"],
    queryFn: async () => {
      const r = await fetch("/api/billing/plans", { credentials: "include" });
      if (!r.ok) return { plans: [] };
      return r.json();
    },
  });

  const { data: invoiceData } = useQuery<{ invoices: any[]; paymentMethod: any | null }>({
    queryKey: ["/api/billing/invoices"],
    queryFn: async () => {
      const r = await fetch("/api/billing/invoices", { credentials: "include" });
      if (!r.ok) return { invoices: [], paymentMethod: null };
      return r.json();
    },
  });

  const billing = tenantInfo?.billing;
  const plan = (tenantInfo?.plan || "trial").toLowerCase();
  const hasPaidSub = !!billing?.hasPaidSubscription;
  const isManual = !!billing?.billingManagedManually;
  const isProOrAbove = plan === "pro" || plan === "enterprise" || plan === "unlimited";
  const seatCount = status?.seatCount ?? null;
  const seatsUsed = status?.seatsUsed ?? null;

  const monthlyPlan = plansData?.plans?.find((p) => p.interval === "month");
  const annualPlan = plansData?.plans?.find((p) => p.interval === "year");
  const hasIntervalChoice = !!(monthlyPlan && annualPlan);

  async function startCheckout() {
    setBusy("checkout");
    try {
      const chosen = billingInterval === "year" ? annualPlan : monthlyPlan;
      const body: any = { seats: 1 };
      if (chosen?.priceId) body.priceId = chosen.priceId;
      const r = await fetch("/api/billing/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok || !data.url) {
        toast.error(data.error || "Failed to start checkout");
        return;
      }
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Checkout failed");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    try {
      const r = await fetch("/api/billing/portal-session", {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok || !data.url) {
        toast.error(data.error || "Failed to open billing portal");
        return;
      }
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Portal failed");
    } finally {
      setBusy(null);
    }
  }

  if (isManual) {
    return (
      <div className="text-sm text-muted-foreground" data-testid="billing-managed-manually">
        Billing for this organization is managed manually. Contact{" "}
        <a className="text-primary hover:underline" href="mailto:contactus@synozur.com">
          contactus@synozur.com
        </a>{" "}
        for changes.
      </div>
    );
  }

  const pm = invoiceData?.paymentMethod;
  const invoices = invoiceData?.invoices ?? [];

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-col gap-3 w-full sm:flex-row sm:items-start sm:justify-between">
      <div className="text-sm text-muted-foreground space-y-1">
        {billing?.inPaymentGrace && (
          <div className="text-destructive font-medium" data-testid="billing-grace-warning">
            Payment failed — please update your payment method before{" "}
            {billing.paymentGraceUntil
              ? new Date(billing.paymentGraceUntil).toLocaleDateString()
              : "the grace period ends"}
            .
          </div>
        )}
        {hasPaidSub && billing?.currentPeriodEnd && (
          <div data-testid="billing-period-end">
            Renews on {new Date(billing.currentPeriodEnd).toLocaleDateString()}
          </div>
        )}
        {seatCount !== null && (
          <div data-testid="billing-seats-usage">
            Seats: <strong>{seatsUsed ?? "?"}</strong> used of <strong>{seatCount}</strong> purchased
          </div>
        )}
        {pm && pm.type === "card" && (
          <div data-testid="billing-payment-method">
            Payment method: {pm.brand?.toUpperCase()} •••• {pm.last4} (exp {pm.expMonth}/{pm.expYear})
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!isProOrAbove && hasIntervalChoice && (
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs" data-testid="billing-interval-toggle">
            <button
              type="button"
              className={`px-3 py-1.5 ${billingInterval === "month" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              onClick={() => setBillingInterval("month")}
              data-testid="button-interval-monthly"
            >
              Monthly
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 ${billingInterval === "year" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              onClick={() => setBillingInterval("year")}
              data-testid="button-interval-annual"
            >
              Annual
            </button>
          </div>
        )}
        {hasPaidSub && (
          <Button
            variant="outline"
            onClick={openPortal}
            disabled={busy !== null}
            data-testid="button-manage-billing"
          >
            {busy === "portal" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Manage Billing
          </Button>
        )}
        {!isProOrAbove && (
          <Button
            onClick={startCheckout}
            disabled={busy !== null}
            data-testid="button-upgrade-pro"
          >
            {busy === "checkout" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Upgrade to Pro
          </Button>
        )}
        {plan === "pro" && (
          <a href="mailto:contactus@synozur.com">
            <Button variant="default" data-testid="button-contact-enterprise">
              Talk to Sales (Enterprise)
            </Button>
          </a>
        )}
      </div>
      </div>
      {invoices.length > 0 && (
        <div className="border-t border-border pt-3" data-testid="billing-invoices">
          <div className="text-xs font-medium text-muted-foreground mb-2">Recent invoices</div>
          <div className="space-y-1">
            {invoices.slice(0, 6).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between text-xs" data-testid={`invoice-row-${inv.id}`}>
                <span>
                  {inv.created ? new Date(inv.created).toLocaleDateString() : "—"}
                  {inv.number ? ` · ${inv.number}` : ""}
                </span>
                <span className="flex items-center gap-3">
                  <span>
                    {((inv.amountPaid ?? inv.amountDue) / 100).toLocaleString(undefined, {
                      style: "currency",
                      currency: (inv.currency || "usd").toUpperCase(),
                    })}
                  </span>
                  <span className="capitalize text-muted-foreground">{inv.status}</span>
                  {inv.hostedInvoiceUrl && (
                    <a
                      href={inv.hostedInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      View
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "Domain Admin" || user?.role === "Global Admin";
  
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Standard User");
  const [inviteOpen, setInviteOpen] = useState(false);
  
  const [brandingName, setBrandingName] = useState("");
  const [brandingPrimary, setBrandingPrimary] = useState("");
  const [brandingSecondary, setBrandingSecondary] = useState("");
  const [brandingAccent, setBrandingAccent] = useState("");
  const [brandingNeutral, setBrandingNeutral] = useState("");
  const [monitoringFreq, setMonitoringFreq] = useState("");
  
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  // Notification preferences
  const [weeklyDigestEnabled, setWeeklyDigestEnabled] = useState(user?.weeklyDigestEnabled ?? true);
  const [alertsEnabled, setAlertsEnabled] = useState(user?.alertsEnabled ?? false);
  const [alertThreshold, setAlertThreshold] = useState(user?.alertThreshold ?? "high");
  const [alertEmailEnabled, setAlertEmailEnabled] = useState(user?.alertEmailEnabled ?? false);
  const [mentionEmailEnabled, setMentionEmailEnabled] = useState(user?.mentionEmailEnabled ?? true);
  const [assignmentEmailEnabled, setAssignmentEmailEnabled] = useState(user?.assignmentEmailEnabled ?? true);
  
  // Entra ID configuration state (simplified - only enable toggle, tenant ID is auto-populated)
  const [entraEnabled, setEntraEnabled] = useState(false);

  // Per-tenant allowed auth providers (Task #105)
  const [allowEntra, setAllowEntra] = useState(true);
  const [allowGoogle, setAllowGoogle] = useState(true);
  const [allowPassword, setAllowPassword] = useState(true);

  // Typography / font management
  const [fontAddOpen, setFontAddOpen] = useState(false);
  const [fontAddName, setFontAddName] = useState("");
  const [fontAddFamily, setFontAddFamily] = useState("");
  const [fontAddWeight, setFontAddWeight] = useState("400");
  const [fontAddStyle, setFontAddStyle] = useState("normal");
  const [fontAddUsage, setFontAddUsage] = useState("heading");
  const [fontUploading, setFontUploading] = useState(false);
  const [fontFileUrl, setFontFileUrl] = useState("");
  const [fontFileType, setFontFileType] = useState("");
  const fontFileInputRef = React.useRef<HTMLInputElement>(null);

  const { data: tenant, isLoading: tenantLoading } = useQuery<TenantSettings>({
    queryKey: ["/api/tenant/settings"],
    enabled: !!user,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team/members"],
    enabled: isAdmin,
  });

  const { data: invites = [], isLoading: invitesLoading } = useQuery<TenantInvite[]>({
    queryKey: ["/api/team/invites"],
    enabled: isAdmin,
  });

  const { data: consultantGrants = [], isLoading: grantsLoading } = useQuery<ConsultantGrant[]>({
    queryKey: ["/api/tenant-access"],
    queryFn: async () => {
      const res = await fetch("/api/tenant-access", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isAdmin,
  });

  const { data: tenantFonts = [], refetch: refetchFonts } = useQuery<TenantFont[]>({
    queryKey: ["/api/tenant/fonts"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/fonts", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: isAdmin,
  });

  const addFontMutation = useMutation({
    mutationFn: async (data: { name: string; fontFamily: string; fontWeight: string; fontStyle: string; fontUsage: string; fileUrl: string; fileType: string }) => {
      const r = await fetch("/api/tenant/fonts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to add font");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/fonts"] });
      setFontAddOpen(false);
      setFontAddName(""); setFontAddFamily(""); setFontAddWeight("400"); setFontAddStyle("normal"); setFontAddUsage("heading"); setFontFileUrl(""); setFontFileType("");
      toast.success("Font added");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteFontMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/tenant/fonts/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to delete font");
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tenant/fonts"] }); toast.success("Font removed"); },
    onError: (err: Error) => toast.error(err.message),
  });

  function fontMimeFromExtension(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    const map: Record<string, string> = {
      ttf: "font/ttf",
      otf: "font/otf",
      woff: "font/woff",
      woff2: "font/woff2",
    };
    return map[ext ?? ""] || "application/octet-stream";
  }

  const handleFontFileUpload = async (file: File) => {
    setFontUploading(true);
    try {
      const contentType = file.type && file.type !== "application/octet-stream"
        ? file.type
        : fontMimeFromExtension(file.name);
      const reqRes = await fetch("/api/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, size: file.size, contentType }),
      });
      if (!reqRes.ok) throw new Error((await reqRes.json()).error);
      const { uploadURL, objectPath } = await reqRes.json();
      const uploadRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
      if (!uploadRes.ok) throw new Error("File upload failed");
      const ext = file.name.split(".").pop()?.toLowerCase() || "font";
      setFontFileUrl(objectPath);
      setFontFileType(ext);
      if (!fontAddName) setFontAddName(file.name.replace(/\.[^.]+$/, ""));
      toast.success("Font file uploaded");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setFontUploading(false);
    }
  };

  const revokeConsultantAccessMutation = useMutation({
    mutationFn: async (grantId: string) => {
      const res = await fetch(`/api/tenant-access/${grantId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to revoke access");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-access"] });
      toast.success("Consultant access revoked");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  React.useEffect(() => {
    if (tenant) {
      setBrandingName(tenant.name || "");
      setBrandingPrimary(tenant.primaryColor || "#810FFB");
      setBrandingSecondary(tenant.secondaryColor || "#E60CB3");
      setBrandingAccent((tenant as any).accentColor || "#F59E0B");
      setBrandingNeutral((tenant as any).neutralColor || "#6B7280");
      setMonitoringFreq(tenant.monitoringFrequency || "weekly");
      setEntraEnabled(tenant.entraEnabled || false);
      const allowed = tenant.allowedAuthProviders && tenant.allowedAuthProviders.length > 0
        ? tenant.allowedAuthProviders
        : ["entra", "google", "password"];
      setAllowEntra(allowed.includes("entra"));
      setAllowGoogle(allowed.includes("google"));
      setAllowPassword(allowed.includes("password"));
    }
  }, [tenant]);

  React.useEffect(() => {
    if (user) {
      setWeeklyDigestEnabled(user.weeklyDigestEnabled ?? true);
      setAlertsEnabled(user.alertsEnabled ?? false);
      setAlertThreshold(user.alertThreshold ?? "high");
      setAlertEmailEnabled(user.alertEmailEnabled ?? false);
      setMentionEmailEnabled(user.mentionEmailEnabled ?? true);
      setAssignmentEmailEnabled(user.assignmentEmailEnabled ?? true);
    }
  }, [user]);

  async function sendInviteRequest() {
    const res = await fetch("/api/team/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    if (!res.ok) {
      const data = await res.json();
      const err: any = new Error(data.error || "Failed to send invite");
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const sendInviteMutation = useMutation({
    mutationFn: async () => {
      try {
        return await sendInviteRequest();
      } catch (err: any) {
        // If we hit the Stripe seat limit, ask the admin to buy an additional
        // seat and re-try the invite automatically.
        if (
          typeof err?.message === "string" &&
          err.message.toLowerCase().includes("seat limit reached")
        ) {
          if (
            window.confirm(
              `${err.message}\n\nWould you like to add 1 seat to your subscription now and re-send this invite?`,
            )
          ) {
            const statusRes = await fetch("/api/billing/status", {
              credentials: "include",
            });
            const status = statusRes.ok ? await statusRes.json() : null;
            const newSeats = (status?.seatCount ?? 1) + 1;
            const seatRes = await fetch("/api/billing/update-seats", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ seats: newSeats }),
            });
            if (!seatRes.ok) {
              const seatErr = await seatRes.json();
              throw new Error(
                seatErr.error || "Failed to add seat to your subscription",
              );
            }
            // Stripe webhook will refresh seat_count; small delay so the
            // server-side check sees the new quantity.
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return await sendInviteRequest();
          }
        }
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/invites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/status"] });
      setInviteEmail("");
      setInviteRole("Standard User");
      setInviteOpen(false);
      toast.success("Invite sent successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/team/invites/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to revoke invite");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/invites"] });
      toast.success("Invite revoked");
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch(`/api/team/members/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update role");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/members"] });
      toast.success("Role updated");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/team/members/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove member");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/members"] });
      toast.success("Member removed");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: brandingName,
          primaryColor: brandingPrimary,
          secondaryColor: brandingSecondary,
          accentColor: brandingAccent,
          neutralColor: brandingNeutral,
          monitoringFrequency: monitoringFreq,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/settings"] });
      toast.success("Settings saved");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) {
        throw new Error("Passwords do not match");
      }
      const res = await fetch("/api/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to change password");
      }
      return data;
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateNotificationsMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await fetch("/api/me/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update notification preferences");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      toast.success("Notification preferences updated");
    },
    onError: (error: Error) => {
      toast.error(error.message);
      if (user) {
        setWeeklyDigestEnabled(user.weeklyDigestEnabled ?? true);
        setAlertsEnabled(user.alertsEnabled ?? false);
        setAlertThreshold(user.alertThreshold ?? "high");
        setAlertEmailEnabled(user.alertEmailEnabled ?? false);
        setMentionEmailEnabled(user.mentionEmailEnabled ?? true);
        setAssignmentEmailEnabled(user.assignmentEmailEnabled ?? true);
      }
    },
  });

  const handleMentionEmailToggle = (checked: boolean) => {
    setMentionEmailEnabled(checked);
    updateNotificationsMutation.mutate({ mentionEmailEnabled: checked });
  };

  const handleAssignmentEmailToggle = (checked: boolean) => {
    setAssignmentEmailEnabled(checked);
    updateNotificationsMutation.mutate({ assignmentEmailEnabled: checked });
  };

  const handleDigestToggle = (checked: boolean) => {
    setWeeklyDigestEnabled(checked);
    updateNotificationsMutation.mutate({ weeklyDigestEnabled: checked });
  };

  const handleAlertToggle = (checked: boolean) => {
    setAlertsEnabled(checked);
    updateNotificationsMutation.mutate({ alertsEnabled: checked });
  };

  const handleAlertThresholdChange = (value: string) => {
    setAlertThreshold(value);
    updateNotificationsMutation.mutate({ alertThreshold: value });
  };

  const handleAlertEmailToggle = (checked: boolean) => {
    setAlertEmailEnabled(checked);
    updateNotificationsMutation.mutate({ alertEmailEnabled: checked });
  };

  const isAlertsPlanEligible = tenant?.plan && !["free", "trial"].includes(tenant.plan);

  const sendDigestNowMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/me/digest/send-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send digest");
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Weekly digest email sent! Check your inbox.");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateEntraMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          entraEnabled,
          allowedAuthProviders: [
            allowEntra ? "entra" : null,
            allowGoogle ? "google" : null,
            allowPassword ? "password" : null,
          ].filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update SSO settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/settings"] });
      toast.success("SSO settings saved");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const pendingInvites = invites.filter(i => i.status === "pending");

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage your workspace, team, and branding.</p>
      </div>

      <div className="space-y-8">
        {isAdmin && (
          <Card data-testid="card-connections">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plug className="h-5 w-5" />
                Connections & Integrations
              </CardTitle>
              <CardDescription>
                Connect outside services to enrich Orbit insights. Manage GA4 below or visit the
                {" "}
                <a href="/app/settings/integrations" className="text-primary hover:underline" data-testid="link-integrations-page">full integrations page</a>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Ga4IntegrationCard embedded showJustConnectedBanner={false} />
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card data-testid="card-team-management">
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Team Management
                  </CardTitle>
                  <CardDescription>Manage team members and invitations.</CardDescription>
                </div>
                <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-invite-member">
                      <UserPlus className="h-4 w-4 mr-2" />
                      Invite Member
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Invite Team Member</DialogTitle>
                      <DialogDescription>
                        Send an invitation to join your organization.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Email Address</Label>
                        <Input
                          type="email"
                          placeholder={`colleague@${tenant?.domain || "company.com"}`}
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          data-testid="input-invite-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Role</Label>
                        <Select value={inviteRole} onValueChange={setInviteRole}>
                          <SelectTrigger data-testid="select-invite-role">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Standard User">Standard User</SelectItem>
                            <SelectItem value="Analyst">Analyst</SelectItem>
                            <SelectItem value="Domain Admin">Domain Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => sendInviteMutation.mutate()}
                        disabled={!inviteEmail || sendInviteMutation.isPending}
                        data-testid="button-send-invite"
                      >
                        {sendInviteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Send Invite
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="text-sm font-medium mb-3">Team Members ({members.length})</h4>
                {membersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
                        <TableRow key={member.id} data-testid={`row-member-${member.id}`}>
                          <TableCell className="font-medium">{member.name}</TableCell>
                          <TableCell>{member.email}</TableCell>
                          <TableCell>
                            <Select
                              value={member.role}
                              onValueChange={(role) => updateRoleMutation.mutate({ userId: member.id, role })}
                              disabled={member.id === user?.id || member.role === "Global Admin"}
                            >
                              <SelectTrigger className="w-[140px]" data-testid={`select-role-${member.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Standard User">Standard User</SelectItem>
                                <SelectItem value="Analyst">Analyst</SelectItem>
                                <SelectItem value="Domain Admin">Domain Admin</SelectItem>
                                {member.role === "Global Admin" && (
                                  <SelectItem value="Global Admin">Global Admin</SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            {member.id !== user?.id && member.role !== "Global Admin" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeMemberMutation.mutate(member.id)}
                                data-testid={`button-remove-${member.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              {pendingInvites.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-medium mb-3">Pending Invitations ({pendingInvites.length})</h4>
                    <div className="space-y-2">
                      {pendingInvites.map((invite) => (
                        <div
                          key={invite.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                          data-testid={`row-invite-${invite.id}`}
                        >
                          <div>
                            <p className="font-medium">{invite.email}</p>
                            <p className="text-sm text-muted-foreground">
                              Role: {invite.invitedRole} · Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revokeInviteMutation.mutate(invite.id)}
                            data-testid={`button-revoke-${invite.id}`}
                          >
                            Revoke
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card data-testid="card-branding">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Branding & Preferences
              </CardTitle>
              <CardDescription>Customize your workspace appearance and settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Organization Name</Label>
                <Input
                  value={brandingName}
                  onChange={(e) => setBrandingName(e.target.value)}
                  data-testid="input-org-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Primary Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandingPrimary}
                      onChange={(e) => setBrandingPrimary(e.target.value)}
                      className="w-10 h-10 rounded border cursor-pointer"
                      data-testid="input-primary-color"
                    />
                    <Input
                      value={brandingPrimary}
                      onChange={(e) => setBrandingPrimary(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Secondary Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandingSecondary}
                      onChange={(e) => setBrandingSecondary(e.target.value)}
                      className="w-10 h-10 rounded border cursor-pointer"
                      data-testid="input-secondary-color"
                    />
                    <Input
                      value={brandingSecondary}
                      onChange={(e) => setBrandingSecondary(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Accent Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandingAccent}
                      onChange={(e) => setBrandingAccent(e.target.value)}
                      className="w-10 h-10 rounded border cursor-pointer"
                      data-testid="input-accent-color"
                    />
                    <Input
                      value={brandingAccent}
                      onChange={(e) => setBrandingAccent(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Neutral Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandingNeutral}
                      onChange={(e) => setBrandingNeutral(e.target.value)}
                      className="w-10 h-10 rounded border cursor-pointer"
                      data-testid="input-neutral-color"
                    />
                    <Input
                      value={brandingNeutral}
                      onChange={(e) => setBrandingNeutral(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Monitoring Frequency</Label>
                <Select value={monitoringFreq} onValueChange={setMonitoringFreq}>
                  <SelectTrigger data-testid="select-monitoring-freq">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  How often Orbit checks your competitors for updates.
                </p>
              </div>
            </CardContent>
            <CardFooter className="border-t border-border px-6 py-4">
              <Button
                onClick={() => updateSettingsMutation.mutate()}
                disabled={updateSettingsMutation.isPending}
                data-testid="button-save-branding"
              >
                {updateSettingsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </CardFooter>
          </Card>
        )}

        {isAdmin && (
          <Card data-testid="card-typography">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Type className="h-5 w-5" />
                    Typography
                  </CardTitle>
                  <CardDescription>Upload and manage custom typefaces for your brand reports and content.</CardDescription>
                </div>
                <Dialog open={fontAddOpen} onOpenChange={v => { setFontAddOpen(v); if (!v) { setFontAddName(""); setFontAddFamily(""); setFontAddWeight("400"); setFontAddStyle("normal"); setFontAddUsage("heading"); setFontFileUrl(""); setFontFileType(""); } }}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-add-tenant-font">
                      <Plus className="h-4 w-4 mr-1" /> Add Font
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add Tenant Font</DialogTitle>
                      <DialogDescription>Upload a custom typeface (.ttf, .otf, .woff, .woff2) and assign it a usage slot.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Font File *</Label>
                        <div className="flex gap-2 items-center mt-1">
                          <input
                            ref={fontFileInputRef}
                            type="file"
                            accept=".ttf,.otf,.woff,.woff2"
                            className="hidden"
                            onChange={e => { if (e.target.files?.[0]) handleFontFileUpload(e.target.files[0]); }}
                            data-testid="input-font-file"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled={fontUploading}
                            onClick={() => fontFileInputRef.current?.click()}
                            data-testid="button-upload-font-file"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            {fontUploading ? "Uploading…" : fontFileUrl ? "Replace File" : "Choose File"}
                          </Button>
                          {fontFileUrl && (
                            <>
                              <style>{`@font-face { font-family: "dial-prev"; src: url("${fontFileUrl}"); font-weight: ${fontAddWeight}; font-style: ${fontAddStyle}; }`}</style>
                              <span
                                className="text-3xl select-none leading-none ml-1"
                                style={{ fontFamily: `"dial-prev", serif`, fontWeight: fontAddWeight, fontStyle: fontAddStyle as any }}
                                title="Live font preview"
                              >Aa</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label>Display Name *</Label>
                        <Input
                          value={fontAddName}
                          onChange={e => setFontAddName(e.target.value)}
                          placeholder="e.g. Inter Regular"
                          data-testid="input-font-name"
                        />
                      </div>
                      <div>
                        <Label>Font Family</Label>
                        <Input
                          value={fontAddFamily}
                          onChange={e => setFontAddFamily(e.target.value)}
                          placeholder="e.g. Inter"
                          data-testid="input-font-family"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Weight</Label>
                          <Select value={fontAddWeight} onValueChange={setFontAddWeight}>
                            <SelectTrigger data-testid="select-font-weight"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {FONT_WEIGHT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Style</Label>
                          <Select value={fontAddStyle} onValueChange={setFontAddStyle}>
                            <SelectTrigger data-testid="select-font-style"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="normal">Normal</SelectItem>
                              <SelectItem value="italic">Italic</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label>Usage Slot *</Label>
                        <Select value={fontAddUsage} onValueChange={setFontAddUsage}>
                          <SelectTrigger data-testid="select-font-usage"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(FONT_USAGE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">Determines where this font is applied in generated documents.</p>
                      </div>
                    </div>
                    <DialogFooter className="mt-4">
                      <Button
                        disabled={!fontAddName.trim() || !fontFileUrl || addFontMutation.isPending}
                        onClick={() => addFontMutation.mutate({ name: fontAddName, fontFamily: fontAddFamily, fontWeight: fontAddWeight, fontStyle: fontAddStyle, fontUsage: fontAddUsage, fileUrl: fontFileUrl, fileType: fontFileType })}
                        data-testid="button-save-font"
                      >
                        {addFontMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Add Font
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {tenantFonts.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-lg" data-testid="text-no-fonts">
                  No custom fonts yet. Add a font to override the default typeface in reports.
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(FONT_USAGE_LABELS).map(([slot, slotLabel]) => {
                    const slotFonts = tenantFonts.filter(f => f.fontUsage === slot);
                    if (slotFonts.length === 0) return null;
                    return (
                      <div key={slot}>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{slotLabel}</p>
                        <div className="space-y-1">
                          {slotFonts.map(font => {
                            const fontId = `settings-font-${font.id}`;
                            return (
                              <div key={font.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border/60 bg-muted/20" data-testid={`row-font-${font.id}`}>
                                <div className="flex items-center gap-3 min-w-0">
                                  <style>{`@font-face { font-family: "${fontId}"; src: url("${font.fileUrl}"); font-weight: ${font.fontWeight || "400"}; font-style: ${font.fontStyle || "normal"}; }`}</style>
                                  <span
                                    className="text-2xl leading-none select-none w-10 text-center shrink-0"
                                    style={{ fontFamily: `"${fontId}", serif`, fontWeight: font.fontWeight || "400", fontStyle: font.fontStyle || "normal" }}
                                  >
                                    Aa
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{font.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {[font.fontFamily, font.fontWeight && `w${font.fontWeight}`, font.fontStyle !== "normal" && font.fontStyle].filter(Boolean).join(" · ")}
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => { if (window.confirm(`Remove "${font.name}"?`)) deleteFontMutation.mutate(font.id); }}
                                  data-testid={`button-delete-font-${font.id}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {user?.authProvider !== "entra" && (
          <Card data-testid="card-password">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Change Password
              </CardTitle>
              <CardDescription>Update your account password.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  data-testid="input-current-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  data-testid="input-confirm-password"
                />
              </div>
            </CardContent>
            <CardFooter className="border-t border-border px-6 py-4">
              <Button
                onClick={() => changePasswordMutation.mutate()}
                disabled={!currentPassword || !newPassword || !confirmPassword || changePasswordMutation.isPending}
                data-testid="button-change-password"
              >
                {changePasswordMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Change Password
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Notification Preferences */}
        <Card data-testid="card-notifications">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notification Preferences
            </CardTitle>
            <CardDescription>Manage your email notification settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="weekly-digest">Weekly Digest</Label>
                <p className="text-sm text-muted-foreground">
                  Receive a weekly email summarizing competitor activity and changes.
                </p>
              </div>
              <Switch
                id="weekly-digest"
                checked={weeklyDigestEnabled}
                onCheckedChange={handleDigestToggle}
                disabled={updateNotificationsMutation.isPending}
                data-testid="switch-weekly-digest"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Send Test Digest</Label>
                <p className="text-sm text-muted-foreground">
                  Send a weekly digest email to yourself right now to preview it.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => sendDigestNowMutation.mutate()}
                disabled={sendDigestNowMutation.isPending}
                data-testid="button-send-digest-now"
              >
                {sendDigestNowMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Send Now
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-competitor-alerts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Competitor Alerts
            </CardTitle>
            <CardDescription>Get notified in real-time when competitors make significant changes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isAlertsPlanEligible ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-center space-y-2">
                <Lock className="h-8 w-8 mx-auto text-primary/60" />
                <p className="text-sm font-medium">Upgrade to Pro or higher</p>
                <p className="text-xs text-muted-foreground">
                  Real-time competitor change alerts are available on Pro, Enterprise, and Unlimited plans.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="alerts-enabled" data-testid="label-alerts-enabled">In-App Alerts</Label>
                    <p className="text-sm text-muted-foreground">
                      Show a notification badge when a competitor website change is detected.
                    </p>
                  </div>
                  <Switch
                    id="alerts-enabled"
                    checked={alertsEnabled}
                    onCheckedChange={handleAlertToggle}
                    disabled={updateNotificationsMutation.isPending}
                    data-testid="switch-alerts-enabled"
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="alert-threshold" data-testid="label-alert-threshold">Significance Threshold</Label>
                    <p className="text-sm text-muted-foreground">
                      Minimum change significance to trigger an alert.
                    </p>
                  </div>
                  <Select
                    value={alertThreshold}
                    onValueChange={handleAlertThresholdChange}
                    disabled={!alertsEnabled || updateNotificationsMutation.isPending}
                  >
                    <SelectTrigger className="w-[180px]" data-testid="select-alert-threshold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">High only</SelectItem>
                      <SelectItem value="medium">Medium & High</SelectItem>
                      <SelectItem value="all">All changes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="alert-email" data-testid="label-alert-email">Email Alerts</Label>
                    <p className="text-sm text-muted-foreground">
                      Also receive an email when a change meets your threshold.
                    </p>
                  </div>
                  <Switch
                    id="alert-email"
                    checked={alertEmailEnabled}
                    onCheckedChange={handleAlertEmailToggle}
                    disabled={!alertsEnabled || updateNotificationsMutation.isPending}
                    data-testid="switch-alert-email"
                  />
                </div>
              </>
            )}
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="mention-email" data-testid="label-mention-email">@Mention emails</Label>
                <p className="text-sm text-muted-foreground">
                  Email me when a teammate @mentions me in a comment.
                </p>
              </div>
              <Switch
                id="mention-email"
                checked={mentionEmailEnabled}
                onCheckedChange={handleMentionEmailToggle}
                disabled={updateNotificationsMutation.isPending}
                data-testid="switch-mention-email"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="assignment-email" data-testid="label-assignment-email">Action item assignment emails</Label>
                <p className="text-sm text-muted-foreground">
                  Email me when a teammate assigns me an action item.
                </p>
              </div>
              <Switch
                id="assignment-email"
                checked={assignmentEmailEnabled}
                onCheckedChange={handleAssignmentEmailToggle}
                disabled={updateNotificationsMutation.isPending}
                data-testid="switch-assignment-email"
              />
            </div>
          </CardContent>
        </Card>

        <ManualActionUsageCard />

        <Card id="plan-usage" data-testid="card-plan">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>Plan & Usage</CardTitle>
                <CardDescription>Your current subscription and usage limits.</CardDescription>
              </div>
              <Badge variant="secondary" className="text-primary bg-primary/10 border-primary/20">
                {tenant?.plan ? tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1) : "Free"} Plan
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 border border-border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Team Members</div>
                <div className="text-2xl font-bold">{tenant?.userCount || 0}</div>
              </div>
              <div className="p-4 border border-border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Competitor Limit</div>
                <div className="text-2xl font-bold">{tenant?.competitorLimit || 3}</div>
              </div>
              <div className="p-4 border border-border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Analysis Limit</div>
                <div className="text-2xl font-bold">{tenant?.analysisLimit || 5}</div>
              </div>
            </div>
          </CardContent>
          {isAdmin && (
            <CardFooter className="border-t border-border px-6 py-4 bg-muted/20">
              <BillingActions />
            </CardFooter>
          )}
        </Card>

        {isAdmin && (
          <Card data-testid="card-allowed-providers">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Allowed Sign-in Methods
              </CardTitle>
              <CardDescription>
                Choose which authentication providers your team can use to sign in.
                At least one must remain enabled.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="allow-entra">Microsoft Entra (SSO)</Label>
                  <p className="text-xs text-muted-foreground">Sign in with Microsoft work accounts</p>
                </div>
                <Switch
                  id="allow-entra"
                  checked={allowEntra}
                  onCheckedChange={setAllowEntra}
                  data-testid="switch-allow-entra"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="allow-google">Google (SSO)</Label>
                  <p className="text-xs text-muted-foreground">Sign in with Google Workspace or personal accounts</p>
                </div>
                <Switch
                  id="allow-google"
                  checked={allowGoogle}
                  onCheckedChange={setAllowGoogle}
                  data-testid="switch-allow-google"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="allow-password">Email + Password</Label>
                  <p className="text-xs text-muted-foreground">Allow local sign-up and password sign-in</p>
                </div>
                <Switch
                  id="allow-password"
                  checked={allowPassword}
                  onCheckedChange={setAllowPassword}
                  data-testid="switch-allow-password"
                />
              </div>
              {!allowEntra && !allowGoogle && !allowPassword && (
                <p className="text-sm text-destructive">At least one sign-in method must be enabled.</p>
              )}
            </CardContent>
            <CardFooter className="border-t border-border px-6 py-4">
              <Button
                onClick={() => updateEntraMutation.mutate()}
                disabled={updateEntraMutation.isPending || (!allowEntra && !allowGoogle && !allowPassword)}
                data-testid="button-save-allowed-providers"
              >
                {updateEntraMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Sign-in Methods
              </Button>
            </CardFooter>
          </Card>
        )}

        {isAdmin && (
          <Card data-testid="card-entra-config">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Microsoft Entra ID (SSO)
              </CardTitle>
              <CardDescription>Configure enterprise Single Sign-On for your organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 bg-muted/50 rounded-lg border border-border">
                <Label className="text-sm font-medium">Redirect URI (copy to Azure Portal)</Label>
                <div className="flex items-center gap-2 mt-2">
                  <code className="flex-1 p-2 bg-background rounded text-sm font-mono break-all">
                    {window.location.origin}/api/auth/entra/callback
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/auth/entra/callback`);
                      toast.success("Redirect URI copied to clipboard");
                    }}
                    data-testid="button-copy-redirect-uri"
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Add this as a "Web" platform redirect URI in your Azure App Registration. No trailing slash.
                </p>
              </div>
              
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="entra-enabled">Enable Microsoft SSO</Label>
                    <p className="text-xs text-muted-foreground">Allow users to sign in with their Microsoft work accounts</p>
                  </div>
                  <Switch
                    id="entra-enabled"
                    checked={entraEnabled}
                    onCheckedChange={setEntraEnabled}
                    data-testid="switch-entra-enabled"
                  />
                </div>
                
                {tenant?.entraTenantId && (
                  <div className="space-y-2">
                    <Label>Azure Tenant ID</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 p-2 bg-background rounded text-sm font-mono text-muted-foreground">
                        {tenant.entraTenantId}
                      </code>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Auto-detected from your first Microsoft sign-in
                    </p>
                  </div>
                )}
                
                {!tenant?.entraTenantId && entraEnabled && (
                  <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
                    <p className="text-sm text-yellow-500">
                      Tenant ID will be auto-detected when a user signs in with Microsoft for the first time.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="border-t border-border px-6 py-4">
              <Button
                onClick={() => updateEntraMutation.mutate()}
                disabled={updateEntraMutation.isPending}
                data-testid="button-save-entra"
              >
                {updateEntraMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save SSO Settings
              </Button>
            </CardFooter>
          </Card>
        )}

        {isAdmin && (
          <Card data-testid="card-consultant-access">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5" />
                Consultant Access
              </CardTitle>
              <CardDescription>Manage which Orbit consultants can access your organization's data.</CardDescription>
            </CardHeader>
            <CardContent>
              {grantsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : consultantGrants.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <UserCog className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No consultants have access to your organization.</p>
                  <p className="text-sm mt-1">Consultant access can be granted by Synozur platform administrators.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Consultant</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Granted By</TableHead>
                      <TableHead>Granted At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consultantGrants.map((grant) => (
                      <TableRow key={grant.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{grant.consultantName || "Unknown"}</div>
                            <div className="text-xs text-muted-foreground">{grant.consultantEmail}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={grant.status === "active" ? "default" : "secondary"}
                            className={grant.status === "active" ? "bg-green-500/20 text-green-500" : ""}
                          >
                            {grant.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{grant.grantedByName || "-"}</TableCell>
                        <TableCell>{new Date(grant.grantedAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          {grant.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => revokeConsultantAccessMutation.mutate(grant.id)}
                              disabled={revokeConsultantAccessMutation.isPending}
                              data-testid={`button-revoke-consultant-${grant.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {isAdmin && <WebhookIntegrationsCard tenantPlan={tenant?.plan} />}

        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>Connect Orbit to your existing stack.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isAdmin && <HubspotIntegrationSection tenantPlan={tenant?.plan} />}
            <Separator />
            <div className="flex items-center justify-between" data-testid="row-developer-portal">
              <div className="space-y-0.5">
                <Label className="text-base">Developer / Partner API</Label>
                <p className="text-sm text-muted-foreground">
                  Build third-party integrations using our OAuth 2.0 + PKCE Partner API. Available on Enterprise and Unlimited plans.
                </p>
              </div>
              <div className="flex gap-2">
                <a href="/app/developer">
                  <Button variant="outline" size="sm" data-testid="link-developer-portal">Developer portal</Button>
                </a>
                {user?.role === "Global Admin" && (
                  <a href="/app/admin/oauth-clients">
                    <Button size="sm" data-testid="link-oauth-clients-admin">Manage OAuth apps</Button>
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

// =====================================================================
// Webhook Integrations (Slack & Teams)
// =====================================================================

interface WebhookConfig {
  id: string;
  kind: "slack" | "teams";
  name: string;
  eventCategories: string[];
  enabled: boolean;
  webhookHostHint: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

const EVENT_CATEGORY_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: "competitor_change", label: "Competitor changes", description: "When monitored competitors update or change significantly." },
  { value: "briefing_ready", label: "Intelligence briefings", description: "When a scheduled intelligence briefing is generated." },
  { value: "weekly_digest", label: "Weekly digest", description: "Once per week, a recap of competitor activity." },
  { value: "job_failed", label: "Job failures", description: "When a scheduled monitoring or briefing job fails." },
];

interface HubspotStatus {
  connected: boolean;
  oauthConfigured: boolean;
  outboundAllowed: boolean;
  needsReauth: boolean;
  connection: null | {
    tenantDomain: string;
    hubspotPortalId: string | null;
    hubspotPortalName: string | null;
    scopes: string[];
    autoPushEnabled: boolean;
    autoCreateHubspotContacts: boolean;
    defaultOwnerId: string | null;
    connectedAt: string;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    lastSyncStats: any;
    emailSyncReady: boolean;
  };
}

function HubspotOwnerPicker({
  currentOwnerId,
  onChange,
}: {
  currentOwnerId: string | null;
  onChange: (ownerId: string | null) => void;
}) {
  const { data, isLoading } = useQuery<{ owners: Array<{ id: string; email: string | null; name: string | null }> }>({
    queryKey: ["/api/integrations/hubspot/owners"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/hubspot/owners", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load owners");
      return res.json();
    },
  });
  const owners = data?.owners ?? [];
  return (
    <div className="flex items-center justify-between pt-2" data-testid="row-hubspot-default-owner">
      <div>
        <Label className="text-sm">Default task owner</Label>
        <p className="text-xs text-muted-foreground">Owner assigned to action-item Tasks pushed back to HubSpot.</p>
      </div>
      <Select
        value={currentOwnerId ?? "__none__"}
        onValueChange={(v) => onChange(v === "__none__" ? null : v)}
        disabled={isLoading || owners.length === 0}
      >
        <SelectTrigger className="w-64" data-testid="select-hubspot-default-owner">
          <SelectValue placeholder={isLoading ? "Loading owners…" : "Unassigned"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Unassigned</SelectItem>
          {owners.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name || o.email || o.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function HubspotIntegrationSection({ tenantPlan }: { tenantPlan?: string }) {
  const queryClient = useQueryClient();
  const planEligible = !!tenantPlan && ["pro", "enterprise", "unlimited"].includes(tenantPlan);

  const { data: status, isLoading } = useQuery<HubspotStatus>({
    queryKey: ["/api/integrations/hubspot/status"],
    enabled: planEligible,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations/hubspot/connect", { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to start HubSpot connect flow");
      return (await res.json()) as { authorizeUrl: string };
    },
    onSuccess: (data) => {
      window.location.href = data.authorizeUrl;
    },
    onError: (err: any) => toast.error(err?.message || "Could not start HubSpot connection"),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations/hubspot", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to disconnect");
    },
    onSuccess: () => {
      toast.success("HubSpot disconnected");
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/hubspot/status"] });
    },
    onError: (err: any) => toast.error(err?.message || "Could not disconnect HubSpot"),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations/hubspot/sync", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Sync failed");
      return (await res.json()) as { stats: { matched: number; enriched: number; dealsAggregated: number; errors: number } };
    },
    onSuccess: (data) => {
      toast.success(`HubSpot sync complete — matched ${data.stats.matched}, enriched ${data.stats.enriched}, deals ${data.stats.dealsAggregated}`);
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/hubspot/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
    },
    onError: (err: any) => toast.error(err?.message || "HubSpot sync failed"),
  });

  const autoPushMutation = useMutation({
    mutationFn: async (autoPushEnabled: boolean) => {
      const res = await fetch("/api/integrations/hubspot", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoPushEnabled }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Update failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/hubspot/status"] });
    },
    onError: (err: any) => toast.error(err?.message || "Could not update preference"),
  });

  const autoCreateMutation = useMutation({
    mutationFn: async (autoCreateHubspotContacts: boolean) => {
      const res = await fetch("/api/integrations/hubspot", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCreateHubspotContacts }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Update failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/hubspot/status"] });
    },
    onError: (err: any) => toast.error(err?.message || "Could not update preference"),
  });

  if (!planEligible) {
    return (
      <div className="flex items-center justify-between" data-testid="row-hubspot-locked">
        <div className="space-y-0.5">
          <Label className="text-base">HubSpot CRM</Label>
          <p className="text-sm text-muted-foreground">
            Enrich competitors from your CRM, surface deal context on briefings, and push battlecards back to HubSpot. Available on Pro and above.
          </p>
        </div>
        <Badge variant="outline">Pro plan required</Badge>
      </div>
    );
  }

  const conn = status?.connection;
  const stats = (conn?.lastSyncStats || {}) as { matched?: number; enriched?: number; dealsAggregated?: number; errors?: number };

  return (
    <div className="space-y-4" data-testid="section-hubspot-integration">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label className="text-base">HubSpot CRM</Label>
          <p className="text-sm text-muted-foreground">
            {status?.outboundAllowed
              ? "Two-way sync: pull deal context onto competitors, push battlecards and action items back to HubSpot Companies."
              : "Inbound sync only on your plan — competitors are enriched with HubSpot data and deal counts. Upgrade to Enterprise to push battlecards / tasks back to HubSpot."}
          </p>
          {status && !status.oauthConfigured && (
            <p className="text-sm text-amber-600" data-testid="text-hubspot-oauth-missing">
              HubSpot OAuth credentials are not configured on this Orbit instance. Ask your administrator to set <code>HUBSPOT_CLIENT_ID</code> and <code>HUBSPOT_CLIENT_SECRET</code>.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : status?.connected ? (
            <Badge variant="default" data-testid="badge-hubspot-connected">Connected</Badge>
          ) : (
            <Badge variant="outline" data-testid="badge-hubspot-disconnected">Not connected</Badge>
          )}
          {!status?.connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => connectMutation.mutate()}
              disabled={!status?.oauthConfigured || connectMutation.isPending}
              data-testid="button-hubspot-connect"
            >
              {connectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
              Connect HubSpot
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="button-hubspot-sync"
              >
                {syncMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                Sync now
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm("Disconnect HubSpot? Tokens will be revoked and CRM enrichment will stop.")) {
                    disconnectMutation.mutate();
                  }
                }}
                disabled={disconnectMutation.isPending}
                data-testid="button-hubspot-disconnect"
              >
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </div>

      {status?.connected && status?.needsReauth && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm flex items-start justify-between gap-4 dark:border-amber-800/60 dark:bg-amber-950/30"
          data-testid="banner-hubspot-reauth"
        >
          <div className="space-y-0.5">
            <p className="font-medium text-amber-800 dark:text-amber-300">Re-authorize to enable marketing-email sync</p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              This connection was authorized before marketing-email sync was added. Re-authorize to grant the new
              timeline and subscription scopes so engagement and unsubscribes sync to HubSpot. Your existing CRM
              enrichment keeps working until you do.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-200"
            onClick={() => connectMutation.mutate()}
            disabled={!status?.oauthConfigured || connectMutation.isPending}
            data-testid="button-hubspot-reauth"
          >
            {connectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
            Re-authorize
          </Button>
        </div>
      )}

      {conn && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1" data-testid="text-hubspot-details">
          <div>
            <span className="text-muted-foreground">Portal:</span>{" "}
            <span data-testid="text-hubspot-portal">{conn.hubspotPortalName || conn.hubspotPortalId || "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Last sync:</span>{" "}
            <span data-testid="text-hubspot-last-sync">{conn.lastSyncAt ? new Date(conn.lastSyncAt).toLocaleString() : "Never"}</span>
            {conn.lastSyncError && (
              <span className="ml-2 text-destructive" data-testid="text-hubspot-last-error">— {conn.lastSyncError}</span>
            )}
          </div>
          {conn.lastSyncStats && (
            <div className="text-muted-foreground" data-testid="text-hubspot-stats">
              Matched {stats.matched ?? 0} competitors · Enriched {stats.enriched ?? 0} · Competitor-deals {stats.dealsAggregated ?? 0}
              {stats.errors ? ` · ${stats.errors} errors` : ""}
            </div>
          )}
          {Array.isArray(conn.scopes) && conn.scopes.length > 0 && (
            <div className="pt-1" data-testid="text-hubspot-scopes">
              <span className="text-muted-foreground text-xs">Granted scopes:</span>{" "}
              <span className="inline-flex flex-wrap gap-1 align-middle">
                {conn.scopes.map((s) => (
                  <Badge key={s} variant="outline" className="text-xs font-normal">{s}</Badge>
                ))}
              </span>
            </div>
          )}
          {status?.outboundAllowed && (
            <HubspotOwnerPicker
              currentOwnerId={conn.defaultOwnerId}
              onChange={(id) =>
                fetch("/api/integrations/hubspot", {
                  method: "PATCH",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ defaultOwnerId: id }),
                })
                  .then(() => queryClient.invalidateQueries({ queryKey: ["/api/integrations/hubspot/status"] }))
                  .catch(() => null)
              }
            />
          )}
          {status?.outboundAllowed && (
            <div className="flex items-center justify-between pt-2">
              <div>
                <Label htmlFor="hubspot-auto-push" className="text-sm">Auto-push briefings as Notes</Label>
                <p className="text-xs text-muted-foreground">When new intelligence briefings are generated, automatically attach them to the matched HubSpot Company.</p>
              </div>
              <Switch
                id="hubspot-auto-push"
                checked={!!conn.autoPushEnabled}
                onCheckedChange={(v) => autoPushMutation.mutate(v)}
                disabled={autoPushMutation.isPending}
                data-testid="switch-hubspot-auto-push"
              />
            </div>
          )}
          {status?.outboundAllowed && (
            <div className="flex items-center justify-between pt-2">
              <div>
                <Label htmlFor="hubspot-auto-create" className="text-sm">Auto-create contacts for email sync</Label>
                <p className="text-xs text-muted-foreground">
                  When a marketing-email recipient has no matching HubSpot contact, create one so engagement and
                  unsubscribe status can be tracked. Turn off if you don't want Orbit creating CRM contacts.
                </p>
              </div>
              <Switch
                id="hubspot-auto-create"
                checked={conn.autoCreateHubspotContacts !== false}
                onCheckedChange={(v) => autoCreateMutation.mutate(v)}
                disabled={autoCreateMutation.isPending || !conn.emailSyncReady}
                data-testid="switch-hubspot-auto-create"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WebhookIntegrationsCard({ tenantPlan }: { tenantPlan?: string }) {
  const queryClient = useQueryClient();
  const allowedPlans = ["enterprise", "unlimited"];
  const planEligible = !!tenantPlan && allowedPlans.includes(tenantPlan);

  const [editing, setEditing] = useState<WebhookConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ kind: "slack" | "teams"; name: string; webhookUrl: string; eventCategories: string[]; enabled: boolean }>({
    kind: "slack",
    name: "",
    webhookUrl: "",
    eventCategories: ["competitor_change", "briefing_ready"],
    enabled: true,
  });

  const { data: webhooks = [], isLoading } = useQuery<WebhookConfig[]>({
    queryKey: ["/api/integrations/webhooks"],
    enabled: planEligible,
  });

  const resetForm = () => {
    setForm({
      kind: "slack",
      name: "",
      webhookUrl: "",
      eventCategories: ["competitor_change", "briefing_ready"],
      enabled: true,
    });
  };

  const openCreate = () => {
    resetForm();
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (wh: WebhookConfig) => {
    setForm({
      kind: wh.kind,
      name: wh.name,
      webhookUrl: "",
      eventCategories: wh.eventCategories,
      enabled: wh.enabled,
    });
    setEditing(wh);
    setCreating(false);
  };

  const closeDialog = () => {
    setEditing(null);
    setCreating(false);
    resetForm();
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/integrations/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create webhook");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/webhooks"] });
      toast.success("Webhook added");
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("Nothing to update");
      const body: Record<string, any> = {
        name: form.name,
        eventCategories: form.eventCategories,
        enabled: form.enabled,
      };
      if (form.webhookUrl.trim().length > 0) body.webhookUrl = form.webhookUrl;
      const res = await fetch(`/api/integrations/webhooks/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update webhook");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/webhooks"] });
      toast.success("Webhook updated");
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/integrations/webhooks/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete webhook");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/webhooks"] });
      toast.success("Webhook removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/integrations/webhooks/${id}/test`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test message failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/webhooks"] });
      toast.success("Test message sent");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleCategory = (value: string) => {
    setForm((prev) => ({
      ...prev,
      eventCategories: prev.eventCategories.includes(value)
        ? prev.eventCategories.filter((c) => c !== value)
        : [...prev.eventCategories, value],
    }));
  };

  const dialogOpen = creating || editing !== null;
  const submitDisabled =
    !form.name.trim() ||
    form.eventCategories.length === 0 ||
    (creating && !form.webhookUrl.trim()) ||
    createMutation.isPending ||
    updateMutation.isPending;

  return (
    <Card data-testid="card-webhook-integrations">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              Slack & Teams Notifications
            </CardTitle>
            <CardDescription>
              Send Orbit alerts to Slack channels or Microsoft Teams via incoming webhooks.
            </CardDescription>
          </div>
          {planEligible && (
            <Button size="sm" onClick={openCreate} data-testid="button-add-webhook">
              <Plus className="h-4 w-4 mr-2" />
              Add Webhook
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!planEligible ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Zap className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium mb-1">Available on Enterprise & Unlimited plans</p>
            <p className="text-sm text-muted-foreground">
              Upgrade to send Orbit notifications directly to Slack and Microsoft Teams.
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium mb-1">No webhooks configured yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Connect a Slack channel or Teams workflow to start receiving Orbit notifications.
            </p>
            <Button size="sm" onClick={openCreate} data-testid="button-add-first-webhook">
              <Plus className="h-4 w-4 mr-2" />
              Add Webhook
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((wh) => (
                <TableRow key={wh.id} data-testid={`row-webhook-${wh.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="uppercase text-[10px]">{wh.kind}</Badge>
                      <div>
                        <div className="font-medium" data-testid={`text-webhook-name-${wh.id}`}>{wh.name}</div>
                        {wh.webhookHostHint && (
                          <div className="text-xs text-muted-foreground">{wh.webhookHostHint}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {wh.eventCategories.map((c) => (
                        <Badge key={c} variant="outline" className="text-xs">
                          {EVENT_CATEGORY_OPTIONS.find((o) => o.value === c)?.label || c}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {wh.lastError ? (
                      <Badge variant="destructive" className="text-xs">Error</Badge>
                    ) : wh.enabled ? (
                      <Badge className="bg-green-500/20 text-green-500 text-xs">Enabled</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Disabled</Badge>
                    )}
                    {wh.lastError && (
                      <div className="text-xs text-destructive mt-1 max-w-[240px] truncate" title={wh.lastError}>
                        {wh.lastError}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {wh.lastUsedAt ? new Date(wh.lastUsedAt).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => testMutation.mutate(wh.id)}
                        disabled={testMutation.isPending}
                        data-testid={`button-test-webhook-${wh.id}`}
                      >
                        {testMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(wh)}
                        data-testid={`button-edit-webhook-${wh.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Remove webhook "${wh.name}"?`)) {
                            deleteMutation.mutate(wh.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-webhook-${wh.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Webhook" : "Add Webhook"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Leave the webhook URL blank to keep the existing one."
                : "Paste an incoming webhook URL from Slack or a Teams workflow connector."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Destination type</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => setForm((prev) => ({ ...prev, kind: v as "slack" | "teams" }))}
                disabled={!!editing}
              >
                <SelectTrigger data-testid="select-webhook-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="teams">Microsoft Teams</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="e.g. #competitive-intel"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                data-testid="input-webhook-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Webhook URL {editing && <span className="text-xs text-muted-foreground">(leave blank to keep current)</span>}</Label>
              <Input
                type="password"
                autoComplete="off"
                placeholder={
                  form.kind === "slack"
                    ? "https://hooks.slack.com/services/..."
                    : "https://prod-xx.westus.logic.azure.com/workflows/..."
                }
                value={form.webhookUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, webhookUrl: e.target.value }))}
                data-testid="input-webhook-url"
              />
              <p className="text-xs text-muted-foreground">
                The URL is encrypted at rest and never displayed again after saving.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Events to send</Label>
              <div className="space-y-2 rounded-md border p-3">
                {EVENT_CATEGORY_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-start gap-3 cursor-pointer" data-testid={`checkbox-event-${opt.value}`}>
                    <Checkbox
                      checked={form.eventCategories.includes(opt.value)}
                      onCheckedChange={() => toggleCategory(opt.value)}
                      className="mt-0.5"
                    />
                    <div className="text-sm">
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-xs text-muted-foreground">{opt.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>Enabled</Label>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm((prev) => ({ ...prev, enabled: v }))}
                data-testid="switch-webhook-enabled"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={() => (editing ? updateMutation.mutate() : createMutation.mutate())}
              disabled={submitDisabled}
              data-testid="button-save-webhook"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editing ? "Save Changes" : "Add Webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface ManualActionUsageRow {
  action: string;
  used: number;
  bonus: number;
  limit: number;
  remaining: number;
  resetsAt: string;
  label: string;
  costTier: "low" | "medium" | "high";
}

interface TenantInfoResponse {
  plan: string;
  manualActionUsage?: Record<string, ManualActionUsageRow>;
}

function ManualActionUsageCard() {
  const { data, isLoading } = useQuery<TenantInfoResponse>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const res = await fetch("/api/tenant/info", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tenant info");
      return res.json();
    },
  });

  const rows: ManualActionUsageRow[] = data?.manualActionUsage
    ? Object.values(data.manualActionUsage)
    : [];
  const resetsAt = rows[0]?.resetsAt ? new Date(rows[0].resetsAt).toLocaleDateString() : "next month";
  const anyLow = rows.some((r) => r.limit !== -1 && r.remaining <= Math.max(1, Math.floor(r.limit * 0.2)));

  return (
    <Card id="manual-action-usage" data-testid="card-manual-action-usage">
      <CardHeader>
        <CardTitle>Monthly Action Usage</CardTitle>
        <CardDescription>
          Cost-driving manual actions count against your plan's monthly cap. Resets on {resetsAt}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading usage...
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage data yet.</p>
        ) : (
          <div className="space-y-3" data-testid="list-manual-action-usage">
            {rows.map((row) => {
              const unlimited = row.limit === -1;
              const overCap = !unlimited && row.remaining === 0;
              const pct = unlimited
                ? 0
                : row.limit === 0
                ? 100
                : Math.min(100, Math.round((row.used / row.limit) * 100));
              const lowRemaining = !unlimited && !overCap && row.remaining <= Math.max(1, Math.floor(row.limit * 0.2));
              const barColor = overCap
                ? "bg-destructive"
                : lowRemaining
                ? "bg-amber-500"
                : "bg-primary";
              return (
                <div
                  key={row.action}
                  className="border border-border rounded-md p-3"
                  data-testid={`row-usage-${row.action}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{row.label}</span>
                      <Badge variant="outline" className="text-xs capitalize">{row.costTier}</Badge>
                      {row.bonus > 0 && (
                        <Badge variant="secondary" className="text-xs">+{row.bonus} bonus</Badge>
                      )}
                    </div>
                    <div className="text-sm tabular-nums" data-testid={`text-used-${row.action}`}>
                      {unlimited ? (
                        <Badge variant="secondary">Unlimited</Badge>
                      ) : overCap ? (
                        <Badge variant="destructive">At cap • {row.used}/{row.limit}</Badge>
                      ) : (
                        <span className="text-muted-foreground">
                          {row.used}/{row.limit}
                        </span>
                      )}
                    </div>
                  </div>
                  {!unlimited && (
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full ${barColor} transition-all`}
                        style={{ width: `${pct}%` }}
                        data-testid={`progress-${row.action}`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      {anyLow && (
        <CardFooter className="border-t border-border px-6 py-4 bg-muted/20 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            You're approaching your plan's monthly cap on one or more actions.
          </span>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              const el = document.getElementById("plan-usage");
              if (el) el.scrollIntoView({ behavior: "smooth" });
            }}
            data-testid="button-upgrade-from-usage"
          >
            Upgrade Plan
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
