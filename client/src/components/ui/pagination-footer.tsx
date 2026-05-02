import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationFooterProps {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
  testIdPrefix?: string;
}

export function PaginationFooter({
  page,
  pageSize,
  total,
  hasMore,
  onPrev,
  onNext,
  testIdPrefix = "pagination",
}: PaginationFooterProps) {
  if (total <= pageSize && page === 1) return null;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div
      className="flex items-center justify-between border-t pt-3 mt-4 text-sm"
      data-testid={`${testIdPrefix}-footer`}
    >
      <span className="text-muted-foreground" data-testid={`${testIdPrefix}-info`}>
        {total === 0 ? "No results" : `Showing ${start}-${end} of ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={page <= 1}
          data-testid={`${testIdPrefix}-prev`}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev
        </Button>
        <span className="text-muted-foreground px-1" data-testid={`${testIdPrefix}-page`}>
          Page {page}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!hasMore}
          data-testid={`${testIdPrefix}-next`}
        >
          Next <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

export interface PaginatedEnvelope<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  page: number;
  pageSize: number;
}
