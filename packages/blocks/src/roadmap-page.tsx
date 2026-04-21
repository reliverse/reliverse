import { Badge } from "@repo/ui/badge";

import { RoadmapTimeline } from "./roadmap-timeline";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export function RoadmapPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Header */}
        <section className="border-b border-border/50 bg-muted/30 py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Badge className="mb-4" variant="secondary">
              2026-2027
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Product Roadmap</h1>
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
              Our vision for the future of the Reliverse ecosystem. Track our progress and see what's
              coming next.
            </p>
          </div>
        </section>

        {/* Roadmap Timeline */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <RoadmapTimeline />
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border/50 bg-muted/30 py-16">
          <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold tracking-tight">Have a Feature Request?</h2>
            <p className="mt-4 text-muted-foreground">
              We'd love to hear your ideas. Open an issue on GitHub or reach out to us directly.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              <a
                className="inline-flex items-center rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                href="https://github.com/blefnk"
                rel="noopener noreferrer"
                target="_blank"
              >
                Submit on GitHub
              </a>
              <a
                className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
                href="/contact"
              >
                Contact Us
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
