"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, LayoutGrid, List, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { type ProjectCategory, projects } from "./lib/projects";
import { PortfolioCard } from "./portfolio-card";
import { ProjectFilter } from "./project-filter";
import { StaggeredGrid } from "./staggered-grid";

export function PortfolioGrid() {
  const [activeCategory, setActiveCategory] = useState<ProjectCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const matchesCategory = activeCategory === "all" || project.category === activeCategory;
      const matchesSearch =
        searchQuery === "" ||
        project.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.subtitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ProjectFilter activeCategory={activeCategory} onCategoryChange={setActiveCategory} />
        <div className="flex items-center gap-2">
          <Button className="hidden bg-transparent sm:flex" size="sm" variant="outline">
            <Link to="/compare">
              <ArrowLeftRight className="mr-2 size-4" />
              Compare
            </Link>
          </Button>
          <div className="flex rounded-lg border border-border/50 p-1">
            <Button
              aria-label="Grid view"
              className="size-8"
              onClick={() => setViewMode("grid")}
              size="icon"
              variant={viewMode === "grid" ? "secondary" : "ghost"}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              aria-label="List view"
              className="size-8"
              onClick={() => setViewMode("list")}
              size="icon"
              variant={viewMode === "list" ? "secondary" : "ghost"}
            >
              <List className="size-4" />
            </Button>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              type="search"
              value={searchQuery}
            />
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Showing {filteredProjects.length} of {projects.length} projects
      </div>

      {filteredProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">No projects found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try adjusting your filters or search query
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <StaggeredGrid className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <PortfolioCard key={project.id} project={project} />
          ))}
        </StaggeredGrid>
      ) : (
        <div className="space-y-4">
          {filteredProjects.map((project) => (
            <PortfolioCard key={project.id} project={project} variant="list" />
          ))}
        </div>
      )}
    </div>
  );
}
