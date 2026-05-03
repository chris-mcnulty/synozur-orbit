import type { Tenant } from "@shared/schema";

export type AuthProvider = "entra" | "google" | "password";

const ALL_PROVIDERS: AuthProvider[] = ["entra", "google", "password"];

export function getAllowedProviders(tenant: Tenant | undefined | null): AuthProvider[] {
  if (!tenant) return ALL_PROVIDERS;
  const list = tenant.allowedAuthProviders;
  if (!list || list.length === 0) return ALL_PROVIDERS;
  return list.filter((p): p is AuthProvider => ALL_PROVIDERS.includes(p as AuthProvider));
}

export function providerAllowedForTenant(tenant: Tenant | undefined | null, provider: AuthProvider): boolean {
  return getAllowedProviders(tenant).includes(provider);
}
