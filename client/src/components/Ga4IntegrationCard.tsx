import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plug, Trash2, CheckCircle2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface GaStatus {
  configured: boolean;
  connection: {
    status: string;
    propertyId: string | null;
    propertyName: string | null;
    lastSyncAt: string | null;
    lastError: string | null;
  } | null;
}

interface GaProperty { id: string; displayName: string; account: string }

interface Ga4IntegrationCardProps {
  showHeader?: boolean;
  showJustConnectedBanner?: boolean;
  embedded?: boolean;
}

export function Ga4IntegrationCard({ showHeader = true, showJustConnectedBanner = true, embedded = false }: Ga4IntegrationCardProps) {
  const [justConnected, setJustConnected] = useState(false);

  useEffect(() => {
    if (!showJustConnectedBanner) return;
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ga") === "connected") {
      setJustConnected(true);
    }
  }, [showJustConnectedBanner]);

  const { data: status } = useQuery<GaStatus>({
    queryKey: ["/api/insights/ga/status"],
    queryFn: async () => {
      const res = await fetch("/api/insights/ga/status", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const { data: propertiesData } = useQuery<{ properties: GaProperty[] }>({
    queryKey: ["/api/insights/ga/properties"],
    enabled: !!status?.connection,
    queryFn: async () => {
      const res = await fetch("/api/insights/ga/properties", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const connectMutation = useMutation<{ url?: string; error?: string }>({
    mutationFn: async () => {
      const res = await fetch("/api/insights/ga/connect", { credentials: "include" });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "Failed");
      return json;
    },
    onSuccess: (json) => { if (json.url) window.location.href = json.url; },
  });

  const setPropertyMutation = useMutation({
    mutationFn: async (p: GaProperty) =>
      apiRequest("POST", "/api/insights/ga/property", { propertyId: p.id, propertyName: p.displayName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/insights/ga/status"] }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/insights/ga/connection"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insights/ga/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights/ga/properties"] });
    },
  });

  const banner = justConnected && (
    <Alert className="mb-4" data-testid="alert-ga-connected">
      <CheckCircle2 className="w-4 h-4" />
      <AlertTitle>Google Analytics connected</AlertTitle>
      <AlertDescription>Pick the GA4 property you want Orbit to read from below.</AlertDescription>
    </Alert>
  );

  const body = (<>
          {status && !status.configured && (
            <Alert>
              <AlertTitle>OAuth not configured</AlertTitle>
              <AlertDescription>Outcomes will use UTM-tagged Orbit links only. Ask the platform admin to set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>.</AlertDescription>
            </Alert>
          )}

          {status?.configured && !status.connection && (
            <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending} data-testid="button-connect-ga">
              Connect Google Analytics
            </Button>
          )}

          {status?.connection && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={status.connection.status === "connected" ? "default" : "destructive"} data-testid="badge-ga-status">
                  {status.connection.status}
                </Badge>
                <span className="text-sm" data-testid="text-ga-property">
                  {status.connection.propertyName || status.connection.propertyId || "No property selected"}
                </span>
                {status.connection.lastSyncAt && (
                  <span className="text-xs text-muted-foreground">Last sync: {new Date(status.connection.lastSyncAt).toLocaleString()}</span>
                )}
                <Button variant="ghost" size="sm" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} data-testid="button-disconnect-ga">
                  <Trash2 className="w-4 h-4 mr-1" />Disconnect
                </Button>
              </div>
              {status.connection.lastError && (
                <p className="text-xs text-destructive" data-testid="text-ga-error">{status.connection.lastError}</p>
              )}

              {propertiesData && propertiesData.properties.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Available properties</p>
                  <ul className="border rounded divide-y">
                    {propertiesData.properties.map((p) => {
                      const selected = status.connection?.propertyId === p.id;
                      return (
                        <li key={p.id} className="p-3 flex items-center justify-between" data-testid={`row-property-${p.id}`}>
                          <div>
                            <div className="font-medium">{p.displayName}</div>
                            <div className="text-xs text-muted-foreground">{p.account} · {p.id}</div>
                          </div>
                          {selected ? (
                            <Badge variant="default"><CheckCircle2 className="w-3 h-3 mr-1" />Selected</Badge>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setPropertyMutation.mutate(p)} disabled={setPropertyMutation.isPending} data-testid={`button-select-property-${p.id}`}>
                              Use this property
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {propertiesData && propertiesData.properties.length === 0 && (
                <p className="text-sm text-muted-foreground">No GA4 properties were returned for this Google account.</p>
              )}
            </>
          )}
        </>
  );

  if (embedded) {
    return (
      <div data-testid="card-integration-ga4" className="space-y-4">
        {banner}
        {body}
      </div>
    );
  }

  return (
    <>
      {banner}
      <Card data-testid="card-integration-ga4">
        {showHeader && (
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plug className="w-4 h-4" /> Google Analytics 4</CardTitle>
            <CardDescription>Connect a GA4 property so outcomes can read real audience and conversion data.</CardDescription>
          </CardHeader>
        )}
        <CardContent className="space-y-4">{body}</CardContent>
      </Card>
    </>
  );
}

export default Ga4IntegrationCard;
