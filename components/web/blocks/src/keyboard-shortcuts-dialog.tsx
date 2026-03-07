"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Kbd } from "@repo/ui/kbd";
import { useEffect, useState } from "react";

interface Shortcut {
  keys: string[];
  description: string;
}

const shortcuts: Shortcut[] = [
  { keys: ["Ctrl", "K"], description: "Open command menu" },
  { keys: ["Ctrl", "/"], description: "Show keyboard shortcuts" },
  { keys: ["G", "H"], description: "Go to home" },
  { keys: ["G", "P"], description: "Go to projects" },
  { keys: ["G", "A"], description: "Go to about" },
  { keys: ["G", "C"], description: "Go to contact" },
  { keys: ["T"], description: "Toggle theme" },
  { keys: ["Esc"], description: "Close dialogs" },
];

export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>Navigate faster with these keyboard shortcuts</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {shortcuts.map((shortcut, index) => (
            <div
              className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 py-2"
              key={index}
            >
              <span className="text-sm text-muted-foreground">{shortcut.description}</span>
              <div className="flex gap-1">
                {shortcut.keys.map((key, keyIndex) => (
                  <Kbd key={keyIndex}>{key}</Kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
