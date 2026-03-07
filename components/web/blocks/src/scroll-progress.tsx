"use client";

import { useEffect, useState } from "react";

export function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const updateProgress = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollTop = window.scrollY;
      const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      setProgress(progress);
    };

    window.addEventListener("scroll", updateProgress);
    return () => window.removeEventListener("scroll", updateProgress);
  }, []);

  return (
    <div className="fixed top-14 left-0 z-50 h-0.5 w-full bg-border/30">
      <div
        className="h-full bg-accent transition-all duration-150"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
