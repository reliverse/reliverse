"use client";

import { cn } from "@repo/ui-utils/cn";
import { Badge } from "@repo/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/card";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Calendar, ExternalLink } from "lucide-react";
import type React from "react";

import type { Project } from "./lib/projects";
import { TiltCard } from "./tilt-card";

interface PortfolioCardProps {
  project: Project;
  variant?: "grid" | "list";
}

const statusStyles: Record<Project["status"], string> = {
  live: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  beta: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  development: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  concept: "bg-muted text-muted-foreground border-border",
};

export function PortfolioCard({ project, variant = "grid" }: PortfolioCardProps) {
  const handleExternalLinkClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (project.externalLink) {
      window.open(project.externalLink, "_blank", "noopener,noreferrer");
    }
  };

  if (variant === "list") {
    return (
      <Link className="group block" params={{ _splat: project.id }} to="/project/$">
        <Card className="overflow-hidden border-border/50 bg-card transition-all duration-300 hover:border-border hover:shadow-lg">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
            <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:aspect-square sm:w-24">
              <img
                alt={project.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                height={225}
                src={project.heroImage || "/placeholder.svg"}
                width={400}
              />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold transition-colors group-hover:text-accent">
                    {project.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{project.subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={cn(
                      "shrink-0 text-[10px] tracking-wider uppercase",
                      statusStyles[project.status],
                    )}
                    variant="outline"
                  >
                    {project.status}
                  </Badge>
                  <ArrowUpRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </div>
              <p className="line-clamp-1 text-sm text-muted-foreground">
                {project.shortDescription}
              </p>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="size-3" />
                  {project.lastUpdate}
                </div>
                <div className="flex flex-wrap gap-1">
                  {project.tags.slice(0, 3).map((tag) => (
                    <Badge className="px-1.5 py-0 text-[10px]" key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </Link>
    );
  }

  return (
    <TiltCard className="h-full">
      <Link className="group block h-full" params={{ _splat: project.id }} to="/project/$">
        <Card className="h-full overflow-hidden border-border/50 bg-card transition-all duration-300 hover:border-border hover:shadow-lg dark:hover:shadow-2xl dark:hover:shadow-accent/5">
          <div className="relative aspect-video overflow-hidden bg-muted">
            <img
              alt={project.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              height={225}
              src={project.heroImage || "/placeholder.svg"}
              width={400}
            />
            <div className="absolute inset-0 bg-linear-to-t from-background/80 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <div className="absolute right-3 bottom-3 opacity-0 transition-all duration-300 group-hover:opacity-100">
              <div className="flex size-8 items-center justify-center rounded-full bg-background/90 text-foreground backdrop-blur-sm">
                <ArrowUpRight className="size-4" />
              </div>
            </div>
            {project.externalLink && (
              <button
                aria-label={`Visit ${project.title} (opens in new tab)`}
                className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:bg-background focus:opacity-100 focus:ring-2 focus:ring-ring focus:outline-none"
                onClick={handleExternalLinkClick}
                type="button"
              >
                <ExternalLink className="size-4" />
              </button>
            )}
          </div>
          <CardHeader className="gap-2 pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="line-clamp-1 text-lg font-semibold tracking-tight transition-colors group-hover:text-accent">
                {project.title}
              </CardTitle>
              <Badge
                className={`shrink-0 text-[10px] tracking-wider uppercase ${statusStyles[project.status]}`}
                variant="outline"
              >
                {project.status}
              </Badge>
            </div>
            <CardDescription className="line-clamp-1 text-sm">{project.subtitle}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
              {project.shortDescription}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {project.tags.slice(0, 3).map((tag) => (
                <Badge
                  className="bg-secondary/50 px-2 py-0 text-[10px] font-medium"
                  key={tag}
                  variant="secondary"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </Link>
    </TiltCard>
  );
}
