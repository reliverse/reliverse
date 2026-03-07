import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2 } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import React, { useRef, useEffect } from "react";
import { Platform } from "react-native";
import { Animated, Easing } from "react-native";
import { Toaster as SonnerToaster, toast } from "sonner-native";

type ToasterProps = React.ComponentPropsWithoutRef<typeof SonnerToaster>;

function Toaster({ ...props }: ToasterProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <SonnerToaster
      theme={colorScheme as "light" | "dark"}
      richColors
      closeButton
      icons={{
        success: <CheckCircle2 size={20} color="hsl(142.1 76.2% 36.3%)" />,
        error: <AlertCircle size={20} color="hsl(346.8 77.2% 49.8%)" />,
        warning: <AlertTriangle size={20} color="hsl(47.9 95.8% 53.1%)" />,
        info: <Info size={20} color="hsl(221.2 83.2% 53.3%)" />,
        loading: (
          <SpinningLoader size={20} color={isDark ? "hsl(0 0% 98%)" : "hsl(240 5.9% 10%)"} />
        ),
      }}
      toastOptions={{
        style: {
          width: Platform.select({ web: 400 }),
          maxWidth: "100%",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };

function SpinningLoader({ size, color }: { size: number; color: string }) {
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Loader2 size={size} color={color} />
    </Animated.View>
  );
}
