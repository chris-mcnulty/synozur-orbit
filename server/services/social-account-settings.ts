/**
 * User-editable social account settings.
 *
 * OAuth provider identity is intentionally absent from this module. Settings
 * routes use this allow-list so an external scheduler destination can never
 * overwrite IDs/URNs used by OAuth reconnect and duplicate recovery.
 */
export interface SocialAccountSettingsInput {
  accountName?: unknown;
  profileUrl?: unknown;
  notes?: unknown;
  socialPilotAccountId?: unknown;
  publishingPaused?: unknown;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function buildSocialAccountSettingsPatch(input: SocialAccountSettingsInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.accountName !== undefined) patch.accountName = optionalText(input.accountName);
  if (input.profileUrl !== undefined) patch.profileUrl = optionalText(input.profileUrl);
  if (input.notes !== undefined) patch.notes = optionalText(input.notes);
  if (input.socialPilotAccountId !== undefined) {
    patch.socialPilotAccountId = optionalText(input.socialPilotAccountId);
  }
  if (input.publishingPaused !== undefined) patch.publishingPaused = Boolean(input.publishingPaused);
  return patch;
}