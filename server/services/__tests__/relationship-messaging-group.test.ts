import { describe, expect, it } from "vitest";
import { relationshipMessagingGroup, resolvedMessagingGroup } from "@shared/relationship-messaging-group";
import { newProspectMetadata } from "@shared/outreach-campaign-workspace";

describe("relationship-based goal brief defaults", () => {
  it.each([
    [["partner", "prospect"], "partner"], [["customer"], "customer"],
    [["customer", "prospect"], "customer"], [["prospect"], "prospect"],
    [["customer", "partner"], null], [["former_customer"], null],
    [["industry_peer"], null], [["unknown"], null], [[], null],
  ])("maps %j conservatively to %s", (roles, expected) => {
    expect(relationshipMessagingGroup(roles)).toBe(expected);
  });
  it("preserves both manual overrides and explicit clearing across relationship changes", () => {
    const meeting = { relationships: ["partner", "prospect"] };
    expect(resolvedMessagingGroup({ meeting })).toEqual({ messagingGroup: "partner", messagingGroupAutomatic: true });
    expect(resolvedMessagingGroup({ meeting, messagingGroup: "partner_prospect" })).toEqual({ messagingGroup: "partner_prospect", messagingGroupAutomatic: false });
    expect(resolvedMessagingGroup({ meeting, messagingGroup: null, signals: { messagingGroupCleared: true } }))
      .toEqual({ messagingGroup: null, messagingGroupAutomatic: false });
    expect(newProspectMetadata({ messagingGroup: null }).signals).toEqual({ messagingGroupCleared: true });
  });
});
