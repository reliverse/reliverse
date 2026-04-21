"use client";

import { Kbd } from "@repo/ui/kbd";
import { useEffect, useState } from "react";

export function KeyboardHint() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
  }, []);

  return (
    <div className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
      Press <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd> <Kbd>K</Kbd> to search
    </div>
  );
}
