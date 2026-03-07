export type ProjectCategory =
  | "platform"
  | "automation"
  | "commerce"
  | "developer"
  | "entertainment"
  | "lifestyle"
  | "personal";

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  lastUpdate: string;
  tags: string[];
  shortDescription: string;
  heroImage: string;
  body?: string;
  externalLink?: string;
  category: ProjectCategory;
  status: "live" | "beta" | "development" | "concept";
}

export const projects: Project[] = [
  {
    id: "blefnk",
    title: "Blefnk",
    subtitle: "Nazar Kornienko - Developer Portfolio",
    lastUpdate: "2026",
    tags: ["Personal", "Portfolio", "Developer"],
    shortDescription:
      "Personal website of Nazar Kornienko, the lead developer behind the Reliverse ecosystem.",
    heroImage: "/placeholder.svg?height=600&width=1200",
    body: `Blefnk is the personal website and portfolio of Nazar Kornienko, the visionary developer behind the entire Reliverse ecosystem. The site showcases his work, thoughts, and contributions to the open-source community.

Nazar has been instrumental in building all Reliverse products, from concept to deployment, with a focus on modern web technologies and user experience.`,
    externalLink: "https://blefnk.reliverse.org",
    category: "personal",
    status: "live",
  },
  {
    id: "relivator",
    title: "Relivator",
    subtitle: "Multi-Template TanStack Start Monorepo",
    lastUpdate: "2026",
    tags: ["TanStack Start", "E-commerce", "AI", "TanStack", "oRPC", "Polar", "Edge Stack"],
    shortDescription:
      "A multi-template monorepo with eCommerce, community-driven features, and AI integration using TanStack/oRPC/Polar edge stack.",
    heroImage: "/placeholder.svg?height=600&width=1200",
    body: `Relivator is our flagship multi-template TanStack Start monorepo, combining eCommerce capabilities with community-driven features and AI integration. Built with the latest edge technologies including TanStack Query, oRPC, and Polar payments.

Features include server components, Polar payments integration, authentication, admin dashboard, inventory management, AI-powered task generation, Blefcoins reward system, and multiple sub-templates for different use cases.`,
    externalLink: "https://relivator.com",
    category: "developer",
    status: "live",
  },
  {
    id: "rse-cli",
    title: "rse",
    subtitle: "Reliverse Command Line Interface",
    lastUpdate: "2026",
    tags: ["CLI", "Developer Tools", "Automation"],
    shortDescription:
      "Powerful command-line interface bringing Reliverse capabilities to your terminal workflow.",
    heroImage: "/placeholder.svg?height=600&width=1200",
    body: `RSE CLI brings the power of Reliverse to your terminal. Build, deploy, and manage applications with simple commands.

Features include project scaffolding, deployment automation, AI assistance, and integration with the broader Reliverse ecosystem.`,
    externalLink: "https://wiki.reliverse.org/docs/libraries/rse",
    category: "developer",
    status: "beta",
  },
  {
    id: "dler",
    title: "Dler",
    subtitle: "TypeScript Library & CLI Builder",
    lastUpdate: "2026",
    tags: ["TypeScript", "CLI", "Open Source"],
    shortDescription:
      "Open-source CLI and framework for building TypeScript/JavaScript libraries and CLI tools easily.",
    heroImage: "/placeholder.svg?height=600&width=1200",
    body: `Dler is our open-source solution for building TypeScript and JavaScript libraries and CLI tools. It simplifies the development workflow with sensible defaults.

Features include zero-config setup, TypeScript support, bundling, testing, publishing helpers, and documentation generation.`,
    externalLink: "https://wiki.reliverse.org/docs/libraries/dler",
    category: "developer",
    status: "live",
  },
  {
    id: "versator",
    title: "Versator",
    subtitle: "Multi-Template Next.js Monorepo",
    lastUpdate: "2026",
    tags: ["Next.js", "E-commerce", "AI", "TanStack", "oRPC", "Polar", "Edge Stack"],
    shortDescription:
      "A production-ready multi-template monorepo with eCommerce, community-driven features, and AI integration using TanStack/oRPC/Polar edge stack.",
    heroImage: "/placeholder.svg?height=600&width=1200",
    body: `Versator is our flagship multi-template Next.js monorepo, combining eCommerce capabilities with community-driven features and AI integration. Built with the latest edge technologies including TanStack Query, oRPC, and Polar payments.

Features include server components, Stripe integration, authentication, admin dashboard, inventory management, AI-powered task generation, Blefcoins reward system, and multiple sub-templates for different use cases.`,
    externalLink: "https://relivator.com",
    category: "developer",
    status: "live",
  },
];

export const getProjectById = (id: string): Project | undefined => {
  return projects.find((project) => project.id === id);
};

export const getProjectsByCategory = (category: ProjectCategory): Project[] => {
  return projects.filter((project) => project.category === category);
};

export const getAllProjectIds = (): string[] => {
  return projects.map((project) => project.id);
};

export const categories: { id: ProjectCategory; label: string }[] = [
  { id: "platform", label: "Platforms" },
  { id: "automation", label: "Automation" },
  { id: "commerce", label: "Commerce" },
  { id: "developer", label: "Developer Tools" },
  { id: "entertainment", label: "Entertainment" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "personal", label: "Personal" },
];
