"use client";

import { cn } from "@repo/ui-utils/cn";
import { Button } from "@repo/ui/button";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Github, Menu, X } from "lucide-react";
import { useState } from "react";

import { KeyboardHint } from "./keyboard-hint";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link className="flex items-center gap-2" to="/">
          <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <span className="text-sm font-bold">B</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">Reliverse</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <a
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="/#projects"
          >
            Projects
          </a>
          <a
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="/#services"
          >
            Services
          </a>
          <Link
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            to="/blog/$"
          >
            Blog
          </Link>
          <Link
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            to="/roadmap"
          >
            Roadmap
          </Link>
          <Link
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            to="/contact"
          >
            Contact
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <KeyboardHint />
          <Button className="size-9" size="icon" variant="ghost">
            <a
              aria-label="GitHub"
              href="https://github.com/blefnk"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Github className="size-4" />
            </a>
          </Button>
          <ThemeToggle />
          <Button className="hidden sm:flex" size="sm">
            <a href="https://reliverse.org" rel="noopener noreferrer" target="_blank">
              Reliverse
              <ExternalLink className="ml-1.5 size-3" />
            </a>
          </Button>
          <Button
            aria-label="Toggle menu"
            className="size-9 md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            size="icon"
            variant="ghost"
          >
            {mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "overflow-hidden border-t border-border/40 transition-all duration-300 md:hidden",
          mobileMenuOpen ? "max-h-64" : "max-h-0",
        )}
      >
        <nav className="flex flex-col gap-1 p-4">
          <button
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => {
              setMobileMenuOpen(false);
              document.getElementById("projects")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Projects
          </button>
          <button
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => {
              setMobileMenuOpen(false);
              document.getElementById("services")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Services
          </button>
          <Link
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setMobileMenuOpen(false)}
            to="/blog/$"
          >
            Blog
          </Link>
          <Link
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setMobileMenuOpen(false)}
            to="/roadmap"
          >
            Roadmap
          </Link>
          <Link
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setMobileMenuOpen(false)}
            to="/contact"
          >
            Contact
          </Link>
          <a
            className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            href="https://reliverse.org"
            rel="noopener noreferrer"
            target="_blank"
          >
            Reliverse
          </a>
        </nav>
      </div>
    </header>
  );
}
