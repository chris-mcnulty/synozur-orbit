/** Maximum active event-level choices, enforced under an event row lock. */
export const MAX_EVENT_ANCHOR_IMAGES = 20;
export const MAX_ANCHOR_HEADLINE = 180;
export const MAX_ANCHOR_SUPPORTING_TEXT = 240;

export function overlayText(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new Error(`Overlay text must be text of at most ${max} characters`);
  }
  return value.trim() || null;
}
