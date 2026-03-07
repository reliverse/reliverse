// Analytics utility for tracking events
// This provides a type-safe way to track custom events

type EventName =
  | "page_view"
  | "project_click"
  | "project_visit"
  | "newsletter_subscribe"
  | "contact_form_submit"
  | "theme_change"
  | "search"
  | "filter_change"
  | "external_link_click"
  | "share";

interface EventProperties {
  page_view: { path: string };
  project_click: { projectId: string; projectName: string };
  project_visit: { projectId: string; source: string };
  newsletter_subscribe: { email: string };
  contact_form_submit: { subject: string };
  theme_change: { theme: string };
  search: { query: string; resultsCount: number };
  filter_change: { category: string };
  external_link_click: { url: string; label: string };
  share: { platform: string; contentType: string; contentId: string };
}

export function trackEvent<T extends EventName>(eventName: T, properties: EventProperties[T]) {
  // In development, log to console
  if (process.env.NODE_ENV === "development") {
    console.log(`[Analytics] ${eventName}:`, properties);
    return;
  }

  // In production, send to analytics service
  // This integrates with Vercel Analytics automatically
  // You can also add other analytics providers here
  try {
    if (
      typeof window !== "undefined" &&
      (window as unknown as { va?: (action: string, data: unknown) => void }).va
    ) {
      (window as unknown as { va: (action: string, data: unknown) => void }).va("event", {
        name: eventName,
        ...properties,
      });
    }
  } catch (error) {
    console.error("Failed to track event:", error);
  }
}

// Convenience functions for common events
export const analytics = {
  trackProjectClick: (projectId: string, projectName: string) =>
    trackEvent("project_click", { projectId, projectName }),

  trackSearch: (query: string, resultsCount: number) =>
    trackEvent("search", { query, resultsCount }),

  trackThemeChange: (theme: string) => trackEvent("theme_change", { theme }),

  trackShare: (platform: string, contentType: string, contentId: string) =>
    trackEvent("share", { platform, contentType, contentId }),

  trackExternalLink: (url: string, label: string) =>
    trackEvent("external_link_click", { url, label }),
};
