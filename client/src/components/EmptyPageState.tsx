import React from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export interface EmptyAction {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "default" | "outline" | "secondary";
  icon?: React.ReactNode;
  testId?: string;
}

export interface EmptyPageStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  primaryAction?: EmptyAction;
  secondaryAction?: EmptyAction;
  learnMoreHref?: string;
  className?: string;
  testId?: string;
}

function renderActionButton(action: EmptyAction | undefined, defaultVariant: "default" | "outline") {
  if (!action) return null;
  if (action.href) {
    return (
      <Button
        variant={action.variant ?? defaultVariant}
        asChild
        data-testid={action.testId}
        className="gap-2"
      >
        <Link href={action.href}>
          {action.icon}
          {action.label}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      variant={action.variant ?? defaultVariant}
      onClick={action.onClick}
      data-testid={action.testId}
      className="gap-2"
    >
      {action.icon}
      {action.label}
    </Button>
  );
}

/**
 * Unified empty state for list/dashboard pages. Provides a consistent
 * illustration, heading, description, and up to two actions. Use this
 * anywhere a user lands on a page with no data yet.
 */
export default function EmptyPageState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  learnMoreHref,
  className,
  testId = "empty-page-state",
}: EmptyPageStateProps) {
  return (
    <Empty
      data-testid={testId}
      className={cn("border border-dashed bg-muted/30", className)}
    >
      <EmptyHeader>
        {icon && (
          <EmptyMedia variant="icon" className="mb-3">
            {icon}
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {(primaryAction || secondaryAction || learnMoreHref) && (
        <EmptyContent>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {renderActionButton(primaryAction, "default")}
            {renderActionButton(secondaryAction, "outline")}
          </div>
          {learnMoreHref && (
            <Link
              href={learnMoreHref}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
              data-testid="empty-learn-more"
            >
              Learn more
            </Link>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}

/**
 * Generic list skeleton used across pages for a consistent loading shimmer.
 */
export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} data-testid="list-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

/**
 * Card/grid skeleton for dashboard-style pages.
 */
export function CardGridSkeleton({
  cards = 4,
  className,
}: {
  cards?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4",
        className
      )}
      data-testid="card-grid-skeleton"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-5 space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-8 w-24 mt-2" />
        </div>
      ))}
    </div>
  );
}
