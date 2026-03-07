import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "react-native-reanimated";
import "#native/styles/globals.css";
import { ConvexProvider } from "#native/components/providers/convex.provider";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  return (
    <ConvexProvider>
      <Stack>
        <Stack.Screen name="home" />
      </Stack>
    </ConvexProvider>
  );
}
