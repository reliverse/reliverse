"use client";

import { cn } from "@repo/ui-utils/cn";
import { Button } from "@repo/ui/button";
import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

export function BackToTop() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      setIsVisible(window.scrollY > 500);
    };

    window.addEventListener("scroll", toggleVisibility);
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  return (
    <Button
      aria-label="Back to top"
      className={cn(
        "fixed right-6 bottom-6 z-50 size-10 rounded-full shadow-lg transition-all duration-300",
        isVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
      onClick={scrollToTop}
      size="icon"
      variant="outline"
    >
      <ArrowUp className="size-4" />
    </Button>
  );
}
