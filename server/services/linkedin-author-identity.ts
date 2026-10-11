type AuthorIdentity = {
  authorUrn?: string | null;
  authorMode?: string | null;
  accountId?: string | null;
};

/** Only recover an explicitly selected personal destination from a verified member URN. */
export function resolveLinkedInAuthor(identity: AuthorIdentity): string | null {
  if (identity.authorUrn) return identity.authorUrn;
  return identity.authorMode === "person"
    && /^urn:li:person:[A-Za-z0-9_-]+$/.test(identity.accountId ?? "")
    ? identity.accountId! : null;
}
