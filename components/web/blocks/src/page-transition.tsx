import { cn } from "@repo/ui-utils/cn";
import { useLocation } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayChildren, setDisplayChildren] = useState(children);

  useEffect(() => {
    setIsTransitioning(true);
    const timeout = setTimeout(() => {
      setDisplayChildren(children);
      setIsTransitioning(false);
    }, 150);

    return () => clearTimeout(timeout);
  }, [children]);

  return (
    <div
      className={cn(
        "transition-all duration-300",
        isTransitioning ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100",
      )}
    >
      {displayChildren}
    </div>
  );
}
