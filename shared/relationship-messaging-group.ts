import { messagingGroups } from "./outreach-context";
type MessagingGroup = typeof messagingGroups[number];

/** Existing relationships take precedence over an additional prospect label.
 * Being both a customer and a partner is genuinely ambiguous; don't guess.
 */
export function relationshipMessagingGroup(relationships: readonly string[] = []): MessagingGroup | null {
  const customer = relationships.includes("customer"), partner = relationships.includes("partner");
  if (customer && partner) return null;
  if (partner) return "partner";
  if (customer) return "customer";
  return relationships.includes("prospect") ? "prospect" : null;
}

export function resolvedMessagingGroup(person: {
  messagingGroup?: string | null; messagingGroupAutomatic?: boolean;
  signals?: Record<string, unknown> | null; meeting?: { relationships?: readonly string[] } | null;
}) {
  const selected = messagingGroups.find(group => group === person.messagingGroup) ?? null;
  const automatic = person.messagingGroupAutomatic ?? (!selected && person.signals?.messagingGroupCleared !== true);
  return {
    messagingGroup: automatic ? relationshipMessagingGroup(person.meeting?.relationships) : selected,
    messagingGroupAutomatic: automatic,
  };
}
