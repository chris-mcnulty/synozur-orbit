/** Recover only accounts belonging to rejected posts that are still available in this market. */
export function rejectedBatchAccountIds(
  posts: { status: string; socialAccountId?: string | null }[],
  accounts: { id: string }[],
): string[] {
  const available = new Set(accounts.map((account) => account.id));
  return [...new Set(posts
    .filter((post) => post.status === "rejected" && post.socialAccountId && available.has(post.socialAccountId))
    .map((post) => post.socialAccountId!))];
}