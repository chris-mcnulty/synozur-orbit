/** Search previews are not importable contact identities. */
export const MAX_APOLLO_REVEAL_BATCH = 10;
export const APOLLO_PREVIEW_TTL_MS = 30 * 60 * 1000;

export interface ApolloSearchPreview {
  id: string;
  displayName: string;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
}

export interface ApolloRevealPreview extends ApolloSearchPreview {
  token: string;
  expiresAt: string;
}

export type ApolloRevealStatus = "revealed" | "unavailable" | "out_of_scope" | "already_attempted" | "failed";
export interface ApolloRevealOutcome {
  previewId: string;
  status: ApolloRevealStatus;
  message: string;
}
