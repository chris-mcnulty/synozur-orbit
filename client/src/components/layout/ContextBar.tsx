import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, Globe, Layers, Plus, Loader2, Link2, FileText, ArrowLeft, Sparkles, Trash2, Pencil, Download, Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useUser } from "@/lib/userContext";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  baselineCompanyName: string | null;
  baselineCompanyUrl: string | null;
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

type MarketCreationStep = "choose" | "url" | "manual";

export default function ContextBar() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createMarketOpen, setCreateMarketOpen] = useState(false);
  const [marketCreationStep, setMarketCreationStep] = useState<MarketCreationStep>("choose");
  const [marketUrl, setMarketUrl] = useState("");
  const [isAnalyzingUrl, setIsAnalyzingUrl] = useState(false);
  const [newMarketName, setNewMarketName] = useState("");
  const [newMarketDescription, setNewMarketDescription] = useState("");
  const [deleteMarketOpen, setDeleteMarketOpen] = useState(false);
  const [marketToDelete, setMarketToDelete] = useState<Market | null>(null);
  const [editMarketOpen, setEditMarketOpen] = useState(false);
  const [marketToEdit, setMarketToEdit] = useState<Market | null>(null);
  const [editMarketName, setEditMarketName] = useState("");
  const [editMarketDescription, setEditMarketDescription] = useState("");

  const resetMarketDialog = () => {
    setMarketCreationStep("choose");
    setMarketUrl("");
    setNewMarketName("");
    setNewMarketDescription("");
    setIsAnalyzingUrl(false);
  };

  const handleCloseMarketDialog = (open: boolean) => {
    setCreateMarketOpen(open);
    if (!open) {
      resetMarketDialog();
    }
  };

  const analyzeMarketUrl = async () => {
    if (!marketUrl.trim()) return;
    
    setIsAnalyzingUrl(true);
    try {
      const response = await fetch("/api/markets/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: marketUrl.trim() }),
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to analyze URL");
      }
      
      const data = await response.json();
      setNewMarketName(data.companyName || "");
      setNewMarketDescription(data.description || "");
      setMarketCreationStep("manual");
    } catch (error: any) {
      toast({
        title: "Analysis failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsAnalyzingUrl(false);
    }
  };

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
      // Invalidate ALL cached queries when switching tenants to ensure complete data refresh
      // This prevents stale data from a different tenant being displayed
      queryClient.invalidateQueries();
    },
  });

  const switchMarketMutation = useMutation({
    mutationFn: async (marketId: string) => {
      const response = await apiRequest("POST", "/api/context/market", { marketId });
      return response.json();
    },
    onSuccess: () => {
      // Invalidate ALL cached queries when switching markets to ensure complete data refresh
      // This prevents stale data from a different market being displayed
      queryClient.invalidateQueries();
    },
  });

  const createMarketMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; websiteUrl?: string }) => {
      const response = await apiRequest("POST", "/api/markets", data);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create market");
      }
      return response.json();
    },
    onSuccess: (newMarket) => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/context"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      handleCloseMarketDialog(false);
      toast({
        title: "Market created",
        description: `"${newMarket.name}" has been created and is now active.`,
      });
      switchMarketMutation.mutate(newMarket.id);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create market",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateMarket = () => {
    if (!newMarketName.trim()) return;
    createMarketMutation.mutate({
      name: newMarketName.trim(),
      description: newMarketDescription.trim() || undefined,
      websiteUrl: marketUrl.trim() || undefined,
    });
  };

  const deleteMarketMutation = useMutation({
    mutationFn: async (marketId: string) => {
      const response = await apiRequest("DELETE", `/api/markets/${marketId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete market");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/context"] });
      setDeleteMarketOpen(false);
      setMarketToDelete(null);
      toast({
        title: "Market deleted",
        description: "The market and all its data have been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete market",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeleteMarket = (market: Market, e: React.MouseEvent) => {
    e.stopPropagation();
    setMarketToDelete(market);
    setDeleteMarketOpen(true);
  };

  const confirmDeleteMarket = () => {
    if (marketToDelete) {
      deleteMarketMutation.mutate(marketToDelete.id);
    }
  };

  const updateMarketMutation = useMutation({
    mutationFn: async ({ marketId, name, description }: { marketId: string; name: string; description?: string }) => {
      const response = await apiRequest("PATCH", `/api/markets/${marketId}`, { name, description });
      // apiRequest already throws on error, so response.ok is guaranteed here
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/context"] });
      setEditMarketOpen(false);
      setMarketToEdit(null);
      toast({
        title: "Market updated",
        description: "Market details have been saved.",
      });
    },
    onError: (error: Error) => {
      // Parse error message - may be JSON or plain text
      let errorMessage = error.message;
      if (errorMessage.includes("<!DOCTYPE")) {
        errorMessage = "Server error - please try again";
      } else {
        // Try to extract JSON error if present
        try {
          const match = errorMessage.match(/\{.*"error".*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            errorMessage = parsed.error || errorMessage;
          }
        } catch {
          // Keep original message
        }
      }
      toast({
        title: "Failed to update market",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const archiveMarketMutation = useMutation({
    mutationFn: async ({ marketId, archive }: { marketId: string; archive: boolean }) => {
      const response = await apiRequest("PATCH", `/api/markets/${marketId}`, { 
        status: archive ? "archived" : "active" 
      });
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/context"] });
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-profile"] });
      toast({
        title: variables.archive ? "Market archived" : "Market restored",
        description: variables.archive 
          ? "All monitoring for this market has been suspended." 
          : "Monitoring has been resumed and data is being refreshed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update market",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleArchiveMarket = (market: Market, e: React.MouseEvent) => {
    e.stopPropagation();
    archiveMarketMutation.mutate({ 
      marketId: market.id, 
      archive: market.status !== "archived" 
    });
  };

  const handleEditMarket = (market: Market, e: React.MouseEvent) => {
    e.stopPropagation();
    setMarketToEdit(market);
    setEditMarketName(market.name);
    setEditMarketDescription(market.description || "");
    setEditMarketOpen(true);
  };

  const confirmEditMarket = () => {
    if (marketToEdit && editMarketName.trim()) {
      updateMarketMutation.mutate({
        marketId: marketToEdit.id,
        name: editMarketName.trim(),
        description: editMarketDescription.trim() || undefined,
      });
    }
  };

  const canSwitchTenants = user?.role === "Global Admin" || user?.role === "Consultant";
  const canDeleteMarket = user?.role === "Global Admin" || user?.role === "Domain Admin";
  const showMarketSelector = marketsData?.multiMarketEnabled;
  const isMarketAdmin = user?.role === "Global Admin" || user?.role === "Domain Admin";
  const hasMarketCapacity = !marketsData?.marketLimit || marketsData.markets.length < marketsData.marketLimit;
  const canCreateMarket = marketsData?.multiMarketEnabled && isMarketAdmin && hasMarketCapacity;
  const showCreateMarketOption = marketsData?.multiMarketEnabled && isMarketAdmin;
  const hasUnlimitedMarkets = !marketsData?.marketLimit;

  if (!canSwitchTenants && !showMarketSelector) {
    return null;
  }

  return (
    <>
      {/* Desktop Context Bar - aligned with sidebar header */}
      <div className="h-14 hidden lg:flex items-center gap-4 px-6 bg-muted/30 border-b border-border">
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
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel className="flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Switch Market
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="max-h-[320px] overflow-y-auto">
                  {marketsData?.markets
                    ?.filter(m => m.status === "active")
                    .map((market) => (
                      <DropdownMenuItem
                        key={market.id}
                        onClick={() => switchMarketMutation.mutate(market.id)}
                        className="flex items-center justify-between cursor-pointer group py-2"
                        data-testid={`menu-item-market-${market.id}`}
                      >
                        <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{market.name}</span>
                            {market.isDefault && (
                              <Badge variant="outline" className="text-[10px]">Default</Badge>
                            )}
                            {market.id === context?.activeMarketId && (
                              <Badge className="text-[10px] bg-primary">Active</Badge>
                            )}
                          </div>
                          {market.baselineCompanyName ? (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Building2 className="w-3 h-3" />
                              <span className="truncate">{market.baselineCompanyName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/60 italic">No baseline set</span>
                          )}
                        </div>
                        {canDeleteMarket && !market.isDefault && (
                          <div className="flex items-center gap-0.5 ml-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary hover:bg-primary/10"
                              onClick={(e) => handleEditMarket(market, e)}
                              data-testid={`btn-edit-market-${market.id}`}
                              title="Edit market"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground ${market.status === "archived" ? "hover:text-green-600 hover:bg-green-500/10" : "hover:text-amber-600 hover:bg-amber-500/10"}`}
                              onClick={(e) => handleArchiveMarket(market, e)}
                              data-testid={`btn-archive-market-${market.id}`}
                              title={market.status === "archived" ? "Restore market" : "Archive market"}
                            >
                              {market.status === "archived" ? (
                                <ArchiveRestore className="h-3 w-3" />
                              ) : (
                                <Archive className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => handleDeleteMarket(market, e)}
                              data-testid={`btn-delete-market-${market.id}`}
                              title="Delete market"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </DropdownMenuItem>
                    ))}
                </div>
                <DropdownMenuSeparator />
                <div className="flex flex-col">
                  {showCreateMarketOption && (
                    <DropdownMenuItem
                      onClick={() => canCreateMarket && setCreateMarketOpen(true)}
                      className={canCreateMarket ? "cursor-pointer" : "cursor-not-allowed opacity-50"}
                      data-testid="btn-create-market"
                      disabled={!canCreateMarket}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {canCreateMarket 
                        ? "Create New Market" 
                        : `Limit reached (${marketsData?.markets.length}/${marketsData?.marketLimit || "∞"})`}
                    </DropdownMenuItem>
                  )}
                  {context?.activeMarketId && (
                    <DropdownMenuItem
                      onClick={() => {
                        window.open(`/api/markets/${context.activeMarketId}/export`, '_blank');
                        toast({
                          title: "Export Started",
                          description: "Your market export file is being downloaded.",
                        });
                      }}
                      className="cursor-pointer"
                      data-testid="btn-export-market"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export Market
                    </DropdownMenuItem>
                  )}
                </div>
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

      {/* Mobile Context Bar - shown in sidebar */}
      <div className="lg:hidden px-4 py-3 border-b border-sidebar-border bg-sidebar-accent/30 space-y-2" data-testid="mobile-context-bar">
        {/* Current context display */}
        <div className="text-xs text-sidebar-foreground/60 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />
          <span>Current Context:</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {context?.activeTenant && (
            <Badge variant="outline" className="text-xs font-normal bg-sidebar-accent">{context.activeTenant.name}</Badge>
          )}
          {context?.activeMarket && showMarketSelector && (
            <Badge variant="secondary" className="text-xs font-normal">{context.activeMarket.name}</Badge>
          )}
        </div>

        {/* Tenant Switcher for mobile */}
        {canSwitchTenants && accessibleTenants && accessibleTenants.tenants.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full justify-between gap-2 text-sidebar-foreground"
                data-testid="dropdown-mobile-tenant-switcher"
              >
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  <span className="truncate">{context?.activeTenant?.name || "Select Organization"}</span>
                </div>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
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
                  data-testid={`mobile-menu-item-tenant-${tenant.id}`}
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

        {/* Market Switcher for mobile */}
        {showMarketSelector && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full justify-between gap-2 text-sidebar-foreground"
                data-testid="dropdown-mobile-market-switcher"
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  <span className="truncate">{context?.activeMarket?.name || "Default"}</span>
                </div>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Switch Market
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-[280px] overflow-y-auto">
                {marketsData?.markets
                  ?.filter(m => m.status === "active")
                  .map((market) => (
                    <DropdownMenuItem
                      key={market.id}
                      onClick={() => switchMarketMutation.mutate(market.id)}
                      className="flex items-center justify-between cursor-pointer py-2"
                      data-testid={`mobile-menu-item-market-${market.id}`}
                    >
                      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{market.name}</span>
                          {market.isDefault && (
                            <Badge variant="outline" className="text-[10px]">Default</Badge>
                          )}
                          {market.id === context?.activeMarketId && (
                            <Badge className="text-[10px] bg-primary">Active</Badge>
                          )}
                        </div>
                        {market.baselineCompanyName ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Building2 className="w-3 h-3" />
                            <span className="truncate">{market.baselineCompanyName}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">No baseline set</span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
              </div>
              {showCreateMarketOption && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => canCreateMarket && setCreateMarketOpen(true)}
                    className={canCreateMarket ? "cursor-pointer" : "cursor-not-allowed opacity-50"}
                    data-testid="mobile-btn-create-market"
                    disabled={!canCreateMarket}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {canCreateMarket 
                      ? "Create New Market" 
                      : `Limit reached (${marketsData?.markets.length}/${marketsData?.marketLimit || "∞"})`}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Dialog open={createMarketOpen} onOpenChange={handleCloseMarketDialog}>
        <DialogContent className="sm:max-w-md">
          {marketCreationStep === "choose" && (
            <>
              <DialogHeader>
                <DialogTitle>Create New Market</DialogTitle>
                <DialogDescription>
                  How would you like to set up this market?
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-4">
                <Button
                  variant="outline"
                  className="h-auto p-4 justify-start text-left flex-col items-start gap-2"
                  onClick={() => setMarketCreationStep("url")}
                  data-testid="btn-market-from-url"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <Link2 className="w-4 h-4" />
                    Start from a website URL
                  </div>
                  <span className="text-xs text-muted-foreground font-normal">
                    We'll analyze the website and auto-fill market details
                  </span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto p-4 justify-start text-left flex-col items-start gap-2"
                  onClick={() => setMarketCreationStep("manual")}
                  data-testid="btn-market-manual"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <FileText className="w-4 h-4" />
                    Enter details manually
                  </div>
                  <span className="text-xs text-muted-foreground font-normal">
                    Provide a name and description yourself
                  </span>
                </Button>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => handleCloseMarketDialog(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          )}

          {marketCreationStep === "url" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6" 
                    onClick={() => setMarketCreationStep("choose")}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  Analyze Website
                </DialogTitle>
                <DialogDescription>
                  Enter a website URL and we'll extract company information to create your market.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="market-url">Website URL</Label>
                  <Input
                    id="market-url"
                    placeholder="https://example.com"
                    value={marketUrl}
                    onChange={(e) => setMarketUrl(e.target.value)}
                    disabled={isAnalyzingUrl}
                    data-testid="input-market-url"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMarketCreationStep("choose")} disabled={isAnalyzingUrl}>
                  Back
                </Button>
                <Button 
                  onClick={analyzeMarketUrl}
                  disabled={!marketUrl.trim() || isAnalyzingUrl}
                  data-testid="btn-analyze-url"
                >
                  {isAnalyzingUrl ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Analyze & Continue
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}

          {marketCreationStep === "manual" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6" 
                    onClick={() => {
                      setNewMarketName("");
                      setNewMarketDescription("");
                      setMarketCreationStep("choose");
                    }}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  Market Details
                </DialogTitle>
                <DialogDescription>
                  Provide the details for your new market.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="market-name">Market Name</Label>
                  <Input
                    id="market-name"
                    placeholder="e.g., Healthcare Division, EMEA Region"
                    value={newMarketName}
                    onChange={(e) => setNewMarketName(e.target.value)}
                    data-testid="input-market-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="market-description">Description (optional)</Label>
                  <Textarea
                    id="market-description"
                    placeholder="Brief description of this market context..."
                    value={newMarketDescription}
                    onChange={(e) => setNewMarketDescription(e.target.value)}
                    rows={3}
                    data-testid="input-market-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setNewMarketName("");
                    setNewMarketDescription("");
                    setMarketCreationStep("choose");
                  }}
                  disabled={createMarketMutation.isPending}
                >
                  Back
                </Button>
                <Button 
                  onClick={handleCreateMarket}
                  disabled={!newMarketName.trim() || createMarketMutation.isPending}
                  data-testid="btn-confirm-create-market"
                >
                  {createMarketMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Market"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Market Confirmation Dialog */}
      <Dialog open={deleteMarketOpen} onOpenChange={setDeleteMarketOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Market</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{marketToDelete?.name}"? This will permanently remove all data associated with this market including competitors, analysis, recommendations, and reports.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteMarketOpen(false);
                setMarketToDelete(null);
              }}
              disabled={deleteMarketMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteMarket}
              disabled={deleteMarketMutation.isPending}
              data-testid="btn-confirm-delete-market"
            >
              {deleteMarketMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Market"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Market Dialog */}
      <Dialog open={editMarketOpen} onOpenChange={(open) => {
        setEditMarketOpen(open);
        if (!open) {
          setMarketToEdit(null);
          setEditMarketName("");
          setEditMarketDescription("");
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Market</DialogTitle>
            <DialogDescription>
              Update the name and description for this market.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-market-name">Name</Label>
              <Input
                id="edit-market-name"
                placeholder="e.g., Enterprise Clients"
                value={editMarketName}
                onChange={(e) => setEditMarketName(e.target.value)}
                data-testid="input-edit-market-name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-market-description">Description (optional)</Label>
              <Textarea
                id="edit-market-description"
                placeholder="Brief description of this market context..."
                value={editMarketDescription}
                onChange={(e) => setEditMarketDescription(e.target.value)}
                rows={3}
                data-testid="input-edit-market-description"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setEditMarketOpen(false);
                setMarketToEdit(null);
              }}
              disabled={updateMarketMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmEditMarket}
              disabled={updateMarketMutation.isPending || !editMarketName.trim()}
              data-testid="btn-confirm-edit-market"
            >
              {updateMarketMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
