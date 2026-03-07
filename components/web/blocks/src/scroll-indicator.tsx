"use client";

import { cn } from "@repo/ui-utils/cn";
import { useEffect, useState } from "react";

export function ScrollIndicator() {
  const [showIndicator, setShowIndicator] = useState(true);

  useEffect(() => {
    const handleScroll = () => {
      setShowIndicator(window.scrollY < 100);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div
      className={cn(
        "absolute bottom-8 left-1/2 -translate-x-1/2 transition-opacity duration-500",
        showIndicator ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs text-muted-foreground">Scroll to explore</span>
        <div className="flex h-6 w-4 items-start justify-center rounded-full border-2 border-muted-foreground/30 p-1">
          <div className="size-1 animate-bounce rounded-full bg-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
