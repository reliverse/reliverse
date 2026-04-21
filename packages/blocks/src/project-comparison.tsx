"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ui/select";
import { ArrowLeftRight, X } from "lucide-react";
import { useState } from "react";

import { type Project, projects } from "./lib/projects";

export function ProjectComparison() {
  const [project1, setProject1] = useState<Project | null>(null);
  const [project2, setProject2] = useState<Project | null>(null);

  const clearComparison = () => {
    setProject1(null);
    setProject2(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <Select
          onValueChange={(value) => setProject1(projects.find((p) => p.id === value) || null)}
          value={project1?.id || ""}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Select first project" />
          </SelectTrigger>
          <SelectContent>
            {projects
              .filter((p) => p.id !== project2?.id)
              .map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <ArrowLeftRight className="size-4 text-muted-foreground" />
        </div>

        <Select
          onValueChange={(value) => setProject2(projects.find((p) => p.id === value) || null)}
          value={project2?.id || ""}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Select second project" />
          </SelectTrigger>
          <SelectContent>
            {projects
              .filter((p) => p.id !== project1?.id)
              .map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        {(project1 || project2) && (
          <Button onClick={clearComparison} size="icon" variant="ghost">
            <X className="size-4" />
          </Button>
        )}
      </div>

      {project1 && project2 && (
        <div className="grid gap-6 md:grid-cols-2">
          {[project1, project2].map((project) => (
            <Card className="border-border/50 bg-card/50" key={project.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {project.title}
                  <Badge
                    className={
                      project.status === "live"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : project.status === "beta"
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-blue-500/10 text-blue-600"
                    }
                    variant="outline"
                  >
                    {project.status}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{project.shortDescription}</p>

                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-sm text-muted-foreground">Category</span>
                    <Badge className="capitalize" variant="secondary">
                      {project.category}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-sm text-muted-foreground">Launch</span>
                    <span className="text-sm">{project.lastUpdate}</span>
                  </div>
                  <div>
                    <span className="mb-2 block text-sm text-muted-foreground">Technologies</span>
                    <div className="flex flex-wrap gap-1">
                      {project.tags.map((tag) => (
                        <Badge className="text-xs" key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!(project1 && project2) && (
        <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 p-12 text-center">
          <p className="text-muted-foreground">
            Select two projects above to compare their features
          </p>
        </div>
      )}
    </div>
  );
}
