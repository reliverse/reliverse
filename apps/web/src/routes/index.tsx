import { ThemeToggle } from "@repo/blocks/theme-toggle";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-10 p-2">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-3xl font-bold sm:text-4xl">Reliverse Developer Tools</h1>

        <div className="flex items-center gap-2 text-sm text-foreground/80 max-sm:flex-col">
          Calm by default. Powerful by design.
        </div>

        <div className="flex items-center gap-2 text-sm text-foreground/80 max-sm:flex-col">
          <pre className="rounded-md border bg-card p-1 text-card-foreground">
            This is an unprotected page: routes/index.tsx
          </pre>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 text-center">
        <p className="max-w-2xl text-sm text-foreground/80 sm:text-base">
          Reliverse is now focused on developer tools, reusable UI building blocks, and landing pages
          for each tool and RSE plugin.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            className="inline-flex h-10 items-center justify-center rounded-4xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/80"
            href="https://github.com/reliverse/reliverse"
            target="_blank"
            rel="noreferrer noopener"
          >
            Explore the monorepo
          </a>
          <a
            className="inline-flex h-10 items-center justify-center rounded-4xl border border-border bg-input/30 px-4 text-sm font-medium transition hover:bg-input/50"
            href="/health"
          >
            Health check
          </a>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <a
            className="text-foreground/80 underline hover:text-foreground max-sm:text-sm"
            href="https://github.com/reliverse/reliverse"
            target="_blank"
            title="Reliverse repository on GitHub"
            rel="noreferrer noopener"
          >
            GitHub
          </a>

          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
