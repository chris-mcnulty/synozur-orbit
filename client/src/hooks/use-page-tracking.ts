import { useEffect } from "react";

function getOrCreateSessionId(): string {
  const key = "orbit_session_id";
  let sessionId = sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem(key, sessionId);
  }
  return sessionId;
}

function getUtmParams(): { utmSource?: string; utmMedium?: string; utmCampaign?: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get("utm_source") || undefined,
    utmMedium: params.get("utm_medium") || undefined,
    utmCampaign: params.get("utm_campaign") || undefined,
  };
}

export function usePageTracking(path: string) {
  useEffect(() => {
    const sessionId = getOrCreateSessionId();
    const utmParams = getUtmParams();
    const referrer = document.referrer || undefined;

    const debounceKey = `orbit_tracked_${path}_${sessionId}`;
    const lastTracked = sessionStorage.getItem(debounceKey);
    const now = Date.now();
    
    if (lastTracked && now - parseInt(lastTracked) < 60000) {
      return;
    }

    sessionStorage.setItem(debounceKey, now.toString());

    fetch("/api/analytics/page-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        sessionId,
        referrer,
        ...utmParams,
      }),
    }).catch(() => {});
  }, [path]);
}
