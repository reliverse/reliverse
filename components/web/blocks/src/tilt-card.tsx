"use client";

import { cn } from "@repo/ui-utils/cn";
import type React from "react";
import { type ReactNode, useRef } from "react";

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  glareEnabled?: boolean;
  maxTilt?: number;
}

export function TiltCard({
  children,
  className,
  glareEnabled = true,
  maxTilt = 10,
}: TiltCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -maxTilt;
    const rotateY = ((x - centerX) / centerX) * maxTilt;

    cardRef.current.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;

    if (glareRef.current && glareEnabled) {
      const glareX = (x / rect.width) * 100;
      const glareY = (y / rect.height) * 100;
      glareRef.current.style.background = `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.15) 0%, transparent 60%)`;
    }
  };

  const handleMouseLeave = () => {
    if (!cardRef.current) return;
    cardRef.current.style.transform = "perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)";
    if (glareRef.current) {
      glareRef.current.style.background = "transparent";
    }
  };

  return (
    <div
      className={cn("relative transition-transform duration-200 ease-out", className)}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      ref={cardRef}
      role="none"
      style={{ transformStyle: "preserve-3d" }}
      tabIndex={-1}
    >
      {children}
      {glareEnabled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-xl transition-opacity"
          ref={glareRef}
        />
      )}
    </div>
  );
}
