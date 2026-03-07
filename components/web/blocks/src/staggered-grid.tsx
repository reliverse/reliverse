"use client";

import { cn } from "@repo/ui-utils/cn";
import { type ReactNode, useEffect, useRef, useState } from "react";

interface StaggeredGridProps {
  children: ReactNode[];
  className?: string;
  staggerDelay?: number;
}

export function StaggeredGrid({ children, className, staggerDelay = 50 }: StaggeredGridProps) {
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number.parseInt(entry.target.getAttribute("data-index") || "0", 10);
            setTimeout(() => {
              setVisibleItems((prev) => new Set(prev).add(index));
            }, index * staggerDelay);
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: "50px",
      },
    );

    const items = containerRef.current?.querySelectorAll("[data-index]");
    items?.forEach((item) => observer.observe(item));

    return () => observer.disconnect();
  }, [staggerDelay]);

  return (
    <div className={className} ref={containerRef}>
      {children.map((child, index) => (
        <div
          className={cn(
            "transition-all duration-500 ease-out",
            visibleItems.has(index) ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0",
          )}
          data-index={index}
          key={index}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
