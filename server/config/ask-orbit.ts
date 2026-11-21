/**
 * Tenant-wide allowance, shared by all users and markets; UTC calendar month.
 * This feature intentionally has no unlimited setting, including Unlimited plans.
 * Change this explicit deployment configuration and restart to adjust the allowance.
 */
export const ASK_ORBIT_CONFIG = {
  monthlyAllowance: 200,
  staleDays: 30,
  timeoutMs: 120_000,
  maxSources: 24,
  maxSourceCharacters: 4_000,
} as const;
