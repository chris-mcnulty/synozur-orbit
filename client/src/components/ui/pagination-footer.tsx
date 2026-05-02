import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationFooterProps {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  testIdPrefix?: string;
}

export function PaginationFooter({
  page,
  pageSize,
  total,
  hasMore,
  onPrev,
  onNext,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  testIdPrefix = "pagination",
}: PaginationFooterProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [jumpValue, setJumpValue] = useState<string>(String(page));

  useEffect(() => {
    setJumpValue(String(page));
  }, [page]);

  if (total <= Math.min(...pageSizeOptions) && page === 1 && !onPageSizeChange) {
    return null;
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const commitJump = () => {
    const parsed = parseInt(jumpValue, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setJumpValue(String(page));
      return;
    }
    const target = Math.min(Math.max(1, parsed), totalPages);
    if (target !== page && onPageChange) {
      onPageChange(target);
    }
    setJumpValue(String(target));
  };

  return (
    <div
      className="flex flex-col gap-3 border-t pt-3 mt-4 text-sm sm:flex-row sm:items-center sm:justify-between"
      data-testid={`${testIdPrefix}-footer`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-muted-foreground" data-testid={`${testIdPrefix}-info`}>
          {total === 0 ? "No results" : `Showing ${start}-${end} of ${total}`}
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(parseInt(v, 10))}
            >
              <SelectTrigger
                className="h-8 w-[80px]"
                data-testid={`${testIdPrefix}-page-size`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((opt) => (
                  <SelectItem
                    key={opt}
                    value={String(opt)}
                    data-testid={`${testIdPrefix}-page-size-option-${opt}`}
                  >
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={page <= 1}
          data-testid={`${testIdPrefix}-prev`}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev
        </Button>
        {onPageChange ? (
          <span
            className="flex items-center gap-1 text-muted-foreground"
            data-testid={`${testIdPrefix}-page`}
          >
            Page
            <Input
              type="number"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              onBlur={commitJump}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitJump();
                }
              }}
              className="h-8 w-16 text-center"
              data-testid={`${testIdPrefix}-jump-input`}
              aria-label="Jump to page"
            />
            of {totalPages}
          </span>
        ) : (
          <span
            className="text-muted-foreground px-1"
            data-testid={`${testIdPrefix}-page`}
          >
            Page {page} of {totalPages}
          </span>
        )}
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

const PAGE_SIZE_STORAGE_PREFIX = "pagination:pageSize:";
const ALLOWED_PAGE_SIZES = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

export function loadPersistedPageSize(key: string, fallback = DEFAULT_PAGE_SIZE): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(PAGE_SIZE_STORAGE_PREFIX + key);
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    if (ALLOWED_PAGE_SIZES.includes(parsed)) return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

export function persistPageSize(key: string, pageSize: number): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PAGE_SIZE_STORAGE_PREFIX + key, String(pageSize));
  } catch {
    // ignore
  }
}

export function usePersistedPageSize(key: string, fallback = DEFAULT_PAGE_SIZE) {
  const [pageSize, setPageSizeState] = useState<number>(() =>
    loadPersistedPageSize(key, fallback),
  );
  const setPageSize = (next: number) => {
    const safe = ALLOWED_PAGE_SIZES.includes(next) ? next : fallback;
    setPageSizeState(safe);
    persistPageSize(key, safe);
  };
  return [pageSize, setPageSize] as const;
}
