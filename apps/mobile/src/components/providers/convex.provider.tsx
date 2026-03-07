import { env } from "@repo/env/expo";
import { ConvexReactClient, ConvexProvider as CVXProvider } from "convex/react";

const convex = new ConvexReactClient(env.EXPO_PUBLIC_CONVEX_URL, {
  unsavedChangesWarning: false,
});

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  return <CVXProvider client={convex}>{children}</CVXProvider>;
}
