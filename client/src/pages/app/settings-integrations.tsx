import { Helmet } from "react-helmet-async";
import { Ga4IntegrationCard } from "@/components/Ga4IntegrationCard";

export default function SettingsIntegrationsPage() {
  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-settings-integrations">
      <Helmet><title>Integrations · Settings</title></Helmet>
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Integrations</h1>
        <p className="text-muted-foreground">Connect outside services to enrich Orbit insights.</p>
      </div>

      <Ga4IntegrationCard />
    </div>
  );
}
