"use client";

import { cn } from "@repo/ui-utils/cn";
import { Badge } from "@repo/ui/badge";

import { categories, type ProjectCategory } from "./lib/projects";

interface ProjectFilterProps {
  activeCategory: ProjectCategory | "all";
  onCategoryChange: (category: ProjectCategory | "all") => void;
}

export function ProjectFilter({ activeCategory, onCategoryChange }: ProjectFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
        onClick={() => onCategoryChange("all")}
      >
        <Badge
          className={cn(
            "cursor-pointer px-3 py-1.5 text-sm transition-all hover:bg-accent hover:text-accent-foreground",
            activeCategory === "all" && "hover:bg-primary/90",
          )}
          variant={activeCategory === "all" ? "default" : "outline"}
        >
          All Projects
        </Badge>
      </button>
      {categories.map((category) => (
        <button
          className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
          key={category.id}
          onClick={() => onCategoryChange(category.id)}
        >
          <Badge
            className={cn(
              "cursor-pointer px-3 py-1.5 text-sm transition-all hover:bg-accent hover:text-accent-foreground",
              activeCategory === category.id && "hover:bg-primary/90",
            )}
            variant={activeCategory === category.id ? "default" : "outline"}
          >
            {category.label}
          </Badge>
        </button>
      ))}
    </div>
  );
}
