import type { Request } from "express";
import { z } from "zod";

export const PAGINATION_DEFAULT_PAGE_SIZE = 25;
export const PAGINATION_MAX_PAGE_SIZE = 100;

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(PAGINATION_MAX_PAGE_SIZE).optional(),
  q: z.string().trim().max(200).optional(),
});

export interface PaginationParams {
  page: number;
  pageSize: number;
  q: string;
  offset: number;
  limit: number;
  isPaginated: boolean;
}

export interface PaginatedEnvelope<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  page: number;
  pageSize: number;
}

/**
 * Parse pagination + search query params from a request.
 *
 * `isPaginated` is true when the caller explicitly supplied a `page` query
 * param. Routes use this flag to preserve backward compatibility: when the
 * caller did not request pagination, return the legacy bare-array response;
 * when the caller did, return a `{ items, total, hasMore, page, pageSize }`
 * envelope.
 */
export function parsePaginationParams(req: Request): PaginationParams {
  const parsed = paginationQuerySchema.safeParse(req.query);
  const data = parsed.success ? parsed.data : {};

  const isPaginated = req.query.page !== undefined;
  const page = data.page ?? 1;
  const pageSize = Math.min(data.pageSize ?? PAGINATION_DEFAULT_PAGE_SIZE, PAGINATION_MAX_PAGE_SIZE);
  const q = (data.q ?? "").trim();

  return {
    page,
    pageSize,
    q,
    offset: (page - 1) * pageSize,
    limit: pageSize,
    isPaginated,
  };
}

/**
 * Build a paginated envelope from a slice of items + total count.
 */
export function buildPaginatedEnvelope<T>(
  items: T[],
  total: number,
  params: Pick<PaginationParams, "page" | "pageSize">,
): PaginatedEnvelope<T> {
  const consumed = params.page * params.pageSize;
  return {
    items,
    total,
    hasMore: consumed < total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/**
 * Escape a user-supplied search string for use inside a SQL ILIKE pattern.
 * Backslash, percent and underscore are the special characters in LIKE/ILIKE.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Build the `%term%` pattern from a search term, escaping LIKE metacharacters.
 */
export function toContainsPattern(term: string): string {
  return `%${escapeLikePattern(term)}%`;
}
