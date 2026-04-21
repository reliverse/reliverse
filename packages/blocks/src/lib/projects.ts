export type ProjectStatus = "live" | "beta" | "development" | "concept";

export type ProjectCategory = "web" | "tooling" | "library" | "design" | "other";

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  shortDescription: string;
  tags: string[];
  status: ProjectStatus;
  category: ProjectCategory;
  lastUpdate: string;
  heroImage?: string;
  externalLink?: string;
}

export const categories: Array<{ id: ProjectCategory; label: string }> = [
  { id: "web", label: "Web" },
  { id: "tooling", label: "Tooling" },
  { id: "library", label: "Library" },
  { id: "design", label: "Design" },
  { id: "other", label: "Other" },
];

export const projects: Project[] = [];
