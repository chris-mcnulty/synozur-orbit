import { Helmet } from "react-helmet-async";
import { Ga4IntegrationCard } from "@/components/Ga4IntegrationCard";
import { WebsiteIntegrationCard } from "@/components/WebsiteIntegrationCard";
import { useUser } from "@/lib/userContext";
import AppLayout from "@/components/layout/AppLayout";
import { Shield } from "lucide-react";

export default function SettingsIntegrationsPage() {
  const { user } = useUser();
  const isAdminUser = user?.role === "Domain Admin" || user?.role === "Global Admin";

  if (user && !isAdminUser) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4" data-testid="access-denied-integrations">
          <Shield className="w-12 h-12 text-muted-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">Access Restricted</h1>
          <p className="text-muted-foreground max-w-sm">
            Integrations settings are only available to administrators. Contact your Domain Admin if you need to configure integrations.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto p-6 space-y-6" data-testid="page-settings-integrations">
        <Helmet><title>Integrations · Settings</title></Helmet>
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Integrations</h1>
          <p className="text-muted-foreground">Connect outside services to enrich Orbit insights.</p>
        </div>

        <Ga4IntegrationCard />
        <WebsiteIntegrationCard />
      </div>
    </AppLayout>
  );
}
