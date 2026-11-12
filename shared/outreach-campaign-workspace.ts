import { z } from "zod";
import { applyCampaignClassification, classificationPatchSchema } from "./campaign-classification";
import { contactFamiliarities, messagingGroups } from "./outreach-context";

/** Validated before creating the shared contact; all metadata is inserted with membership. */
export const newProspectMetadataSchema = z.object({
  classification: classificationPatchSchema.optional(),
  messagingGroup: z.enum(messagingGroups).nullable().optional(),
  familiarity: z.enum(contactFamiliarities).optional(),
});
export function newProspectMetadata(input: unknown) {
  const value = newProspectMetadataSchema.parse(input);
  return {
    ...(value.classification ? applyCampaignClassification(null, null, value.classification) : {}),
    ...(value.messagingGroup !== undefined ? { messagingGroup: value.messagingGroup } : {}),
    ...(value.familiarity !== undefined ? { familiarity: value.familiarity } : {}),
  };
}
