import { sql } from "drizzle-orm";
import { prospects } from "@shared/schema";
import type { messagingGroups } from "@shared/outreach-context";

/** Atomic JSON merge preserves research, completion and other membership signals. */
export function messagingGroupPatch(group: typeof messagingGroups[number] | null) {
  return {
    messagingGroup: group,
    signals: sql`jsonb_set(coalesce(${prospects.signals}, '{}'::jsonb), '{messagingGroupCleared}', ${JSON.stringify(group === null)}::jsonb, true)`,
  };
}
