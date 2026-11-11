import { ApiError } from "@/lib/queryClient";

export function isOutreachContextError(error: unknown): error is ApiError {
  return error instanceof ApiError && ["OUTREACH_CONTEXT_CHANGED", "OUTREACH_ON_HOLD"].includes(error.code ?? "");
}

/** At most two POSTs: one initial attempt and one explicitly reviewed retry.
 * A second conflict returns control to the seller; a hold is never retried.
 */
export async function generateWithOutreachReview<T>({
  confirm, generate, fingerprint,
}: {
  confirm: (fingerprint?: string) => Promise<string>;
  generate: (fingerprint: string) => Promise<T>;
  fingerprint?: string;
}): Promise<T> {
  const reviewed = await confirm(fingerprint);
  try {
    return await generate(reviewed);
  } catch (error) {
    if (!isOutreachContextError(error) || error.code !== "OUTREACH_CONTEXT_CHANGED") throw error;
  }
  const refreshed = await confirm();
  return generate(refreshed);
}
