import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, Globe, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useUser } from "@/lib/userContext";
import { apiRequest } from "@/lib/queryClient";

interface Tenant {
  id: string;
  domain: string;
  name: string;
  plan: string;
  status: string;
  multiMarketEnabled?: boolean;
}

interface Market {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  status: string;
}

interface ContextData {
  activeTenantId: string | null;
  activeMarketId: string | null;
  activeTenant: Tenant | null;
  activeMarket: Market | null;
  canSwitchTenants: boolean;
}

interface AccessibleTenantsData {
  tenants: Tenant[];
  activeTenantId: string | null;
  activeMarketId: string | null;
  canSwitchTenants: boolean;
}

interface MarketsData {
  markets: Market[];
  activeMarketId: string | null;
  multiMarketEnabled: boolean;
  marketLimit: number;
}

export default function ContextBar() {
  const { user } = useUser();
  const queryClient = useQueryClient();

  const { data: context, isLoading: contextLoading } = useQuery<ContextData>({
    queryKey: ["/api/context"],
    queryFn: async () => {
      const response = await fetch("/api/context", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load context");
      return response.json();
    },
    enabled: !!user,
  });

  const { data: accessibleTenants } = useQuery<AccessibleTenantsData>({
    queryKey: ["/api/tenants/accessible"],
    queryFn: async () => {
      const response = await fetch("/api/tenants/accessible", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load tenants");
      return response.json();
    },
    enabled: !!user && (user.role === "Global Admin" || user.role === "Consultant"),
  });

  const { data: marketsData } = useQuery<MarketsData>({
    queryKey: ["/api/markets"],
    queryFn: async () => {
      const response = await fetch("/api/markets", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load markets");
      return response.json();
    },
    enabled: !!user && !!context?.activeTenantId,
  });

  const switchTenantMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      const response = await apiRequest("POST", "/api/context/tenant", { tenantId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/context"] });
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
    },
  });

  const switchMarketMutation = useMutation({
    mutationFn: async (marketId: string) => {
      const response = await apiRequest("POST", "/api/context/market", { marketId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/context"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
    },
  });

  const canSwitchTenants = user?.role === "Global Admin" || user?.role === "Consultant";
  const showMarketSelector = marketsData?.multiMarketEnabled && marketsData?.markets && marketsData.markets.length > 1;

  if (!canSwitchTenants && !showMarketSelector) {
    return null;
  }

  return (
    <div className="h-12 hidden lg:flex items-center gap-4 px-6 bg-muted/30 border-b border-border">
      {canSwitchTenants && accessibleTenants && accessibleTenants.tenants.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              className="gap-2 text-muted-foreground hover:text-foreground"
              data-testid="dropdown-tenant-switcher"
            >
              <Building2 className="w-4 h-4" />
              <span className="max-w-32 truncate">{context?.activeTenant?.name || "Select Tenant"}</span>
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Switch Organization
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {accessibleTenants.tenants.map((tenant) => (
              <DropdownMenuItem
                key={tenant.id}
                onClick={() => switchTenantMutation.mutate(tenant.id)}
                className="flex items-center justify-between cursor-pointer"
                data-testid={`menu-item-tenant-${tenant.id}`}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{tenant.name}</span>
                  <span className="text-xs text-muted-foreground">{tenant.domain}</span>
                </div>
                {tenant.id === context?.activeTenantId && (
                  <Badge variant="secondary" className="text-xs">Active</Badge>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {showMarketSelector && (
        <>
          {canSwitchTenants && accessibleTenants && accessibleTenants.tenants.length > 1 && (
            <div className="h-4 w-px bg-border" />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2 text-muted-foreground hover:text-foreground"
                data-testid="dropdown-market-switcher"
              >
                <Layers className="w-4 h-4" />
                <span className="max-w-32 truncate">{context?.activeMarket?.name || "Default"}</span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Switch Market
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {marketsData.markets
                .filter(m => m.status === "active")
                .map((market) => (
                  <DropdownMenuItem
                    key={market.id}
                    onClick={() => switchMarketMutation.mutate(market.id)}
                    className="flex items-center justify-between cursor-pointer"
                    data-testid={`menu-item-market-${market.id}`}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{market.name}</span>
                      {market.description && (
                        <span className="text-xs text-muted-foreground truncate max-w-40">{market.description}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {market.isDefault && (
                        <Badge variant="outline" className="text-[10px]">Default</Badge>
                      )}
                      {market.id === context?.activeMarketId && (
                        <Badge variant="secondary" className="text-xs">Active</Badge>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      <div className="flex-1" />

      {context?.activeTenant && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span>Viewing:</span>
          <Badge variant="outline" className="text-xs font-normal">{context.activeTenant.name}</Badge>
          {context.activeMarket && showMarketSelector && (
            <>
              <span>/</span>
              <Badge variant="outline" className="text-xs font-normal">{context.activeMarket.name}</Badge>
            </>
          )}
        </div>
      )}
    </div>
  );
}
