import { Badge } from "@repo/ui/badge";
import { Card } from "@repo/ui/card";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { projects } from "./lib/projects";

export function FeaturedProjects() {
  // Get featured projects (live and beta status)
  const featuredProjects = projects
    .filter((p) => p.status === "live" || p.status === "beta")
    .slice(0, 4);

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 flex items-end justify-between">
          <div>
            <Badge className="mb-4" variant="secondary">
              Featured
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Top Projects</h2>
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
              Our most popular and actively maintained projects
            </p>
          </div>
          <a
            className="hidden items-center gap-1 text-sm font-medium text-accent hover:underline sm:flex"
            href="/#projects"
          >
            View all projects
            <ArrowRight className="size-4" />
          </a>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {featuredProjects.map((project) => (
            <Link
              className="group"
              key={project.id}
              params={{ _splat: project.id }}
              to="/project/$"
            >
              <Card className="h-full overflow-hidden border-border/50 transition-all hover:border-border hover:shadow-lg">
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <img
                    alt={project.title}
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                    height={400}
                    sizes="(max-width: 768px) 50vw, 25vw"
                    src={project.heroImage || "/placeholder.svg"}
                    width={400}
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-background/80 to-transparent" />
                  <div className="absolute right-4 bottom-4 left-4">
                    <h3 className="font-semibold text-white">{project.title}</h3>
                    <p className="mt-1 line-clamp-1 text-sm text-white/80">{project.subtitle}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-center sm:hidden">
          <a
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            href="/#projects"
          >
            View all projects
            <ArrowRight className="size-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
