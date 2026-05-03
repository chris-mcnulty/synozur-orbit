import { Skeleton } from "./skeleton";

export function CompetitorRowSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-6" data-testid="skeleton-competitor-row">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <Skeleton className="h-5 w-5 rounded-sm shrink-0" />
          <Skeleton className="w-14 h-14 rounded-lg shrink-0" />
          <div className="space-y-2 min-w-0 flex-1">
            <Skeleton className="h-5 w-48 max-w-full" />
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-3 w-40 max-w-full" />
          </div>
        </div>
        <div className="flex items-center gap-6 shrink-0">
          <div className="hidden md:block space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CompetitorListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-6" data-testid="skeleton-competitor-list">
      {Array.from({ length: count }).map((_, i) => (
        <CompetitorRowSkeleton key={i} />
      ))}
    </div>
  );
}

export function PersonaCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card overflow-hidden" data-testid="skeleton-persona-card">
      <div className="p-6 pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
      <div className="px-6 pb-6 space-y-3">
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <div className="flex gap-1 flex-wrap">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-12" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <div className="flex gap-1 flex-wrap">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-14" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PersonaGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
      data-testid="skeleton-persona-grid"
    >
      {Array.from({ length: count }).map((_, i) => (
        <PersonaCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ContentTableRowSkeleton() {
  return (
    <tr className="border-b last:border-0" data-testid="skeleton-content-row">
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded shrink-0" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3">
        <Skeleton className="h-5 w-20 rounded-full" />
      </td>
      <td className="py-2.5 px-3">
        <Skeleton className="h-5 w-14 rounded-full" />
      </td>
      <td className="py-2.5 px-3">
        <Skeleton className="h-4 w-20" />
      </td>
      <td className="py-2.5 px-3">
        <Skeleton className="h-3 w-16" />
      </td>
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-1 justify-end">
          <Skeleton className="h-7 w-14 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
        </div>
      </td>
    </tr>
  );
}

export function ContentTableSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="rounded-lg border overflow-hidden" data-testid="skeleton-content-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="text-left py-2.5 px-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
              Content
            </th>
            <th className="text-left py-2.5 px-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
              Category
            </th>
            <th className="text-left py-2.5 px-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
              Status
            </th>
            <th className="text-left py-2.5 px-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
              AI Extraction
            </th>
            <th className="text-left py-2.5 px-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
              Added
            </th>
            <th className="text-right py-2.5 px-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: count }).map((_, i) => (
            <ContentTableRowSkeleton key={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ContentCardSkeleton() {
  return (
    <div className="space-y-2" data-testid="skeleton-content-card">
      <Skeleton className="aspect-video w-full rounded-lg" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function ContentCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 items-start"
      data-testid="skeleton-content-grid"
    >
      {Array.from({ length: count }).map((_, i) => (
        <ContentCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function BrandTileSkeleton() {
  return (
    <div className="space-y-2" data-testid="skeleton-brand-tile">
      <Skeleton className="aspect-video w-full rounded-lg" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function BrandGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid gap-5 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 items-start"
      data-testid="skeleton-brand-grid"
    >
      {Array.from({ length: count }).map((_, i) => (
        <BrandTileSkeleton key={i} />
      ))}
    </div>
  );
}

export function CampaignCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-3" data-testid="skeleton-campaign-card">
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-16 rounded-full shrink-0" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <div className="flex flex-wrap gap-1 pt-1">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-3 w-32" />
        <div className="flex gap-1">
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-16 rounded" />
        </div>
      </div>
    </div>
  );
}

export function CampaignGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      data-testid="skeleton-campaign-grid"
    >
      {Array.from({ length: count }).map((_, i) => (
        <CampaignCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function EmailRowSkeleton() {
  return (
    <div className="rounded-lg border bg-card py-4 px-6" data-testid="skeleton-email-row">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-72 max-w-full" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
        </div>
      </div>
    </div>
  );
}

export function EmailListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" data-testid="skeleton-email-list">
      {Array.from({ length: count }).map((_, i) => (
        <EmailRowSkeleton key={i} />
      ))}
    </div>
  );
}

export function LongFormContentSkeleton() {
  return (
    <div className="border rounded-lg p-6 bg-muted/30 space-y-4" data-testid="skeleton-longform">
      <Skeleton className="h-7 w-1/2" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <Skeleton className="h-6 w-1/3 mt-2" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <Skeleton className="h-6 w-2/5 mt-2" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}

export function ProductCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
      data-testid="skeleton-product-card-grid"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start justify-between p-4 rounded-lg border bg-card">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-10 rounded-full" />
            </div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="flex flex-col gap-1 ml-2">
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-7 w-7 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BattlecardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4" data-testid="skeleton-battlecard-list">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between p-4 bg-muted/30">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-8 w-32 rounded" />
          </div>
          <div className="p-4 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BriefingPanelSkeleton() {
  return (
    <div className="space-y-6" data-testid="skeleton-briefing-panel">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card pt-4 pb-3 px-4">
            <Skeleton className="h-3 w-16 mb-2" />
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="space-y-2 pt-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
      <div>
        <Skeleton className="h-5 w-32 mb-3" />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card pt-4 pb-4 px-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="h-5 w-24 mb-3" />
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4">
              <div className="flex gap-3">
                <Skeleton className="h-5 w-5 rounded-full shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
