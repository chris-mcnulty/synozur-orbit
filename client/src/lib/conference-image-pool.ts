/** Shared by the event editor and its API contract test. */
export async function archiveEventPoolImage(imageId: string): Promise<void> {
  const response = await fetch(`/api/conference-images/${encodeURIComponent(imageId)}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ archived: true }),
  });
  if (!response.ok) {
    throw new Error((await response.json().catch(() => ({}))).error || "Failed to archive image");
  }
}
