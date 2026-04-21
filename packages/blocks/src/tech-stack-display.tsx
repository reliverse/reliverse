import { Badge } from "@repo/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@repo/ui/tooltip";

interface Technology {
  name: string;
  category: string;
  description: string;
}

const techStack: Technology[] = [
  { name: "Next.js", category: "Framework", description: "React framework for production" },
  { name: "React", category: "Library", description: "UI component library" },
  { name: "TypeScript", category: "Language", description: "Typed JavaScript" },
  { name: "Tailwind CSS", category: "Styling", description: "Utility-first CSS framework" },
  { name: "Node.js", category: "Runtime", description: "JavaScript runtime" },
  { name: "PostgreSQL", category: "Database", description: "Relational database" },
  { name: "Redis", category: "Cache", description: "In-memory data store" },
  { name: "Vercel", category: "Hosting", description: "Edge deployment platform" },
  { name: "Stripe", category: "Payments", description: "Payment processing" },
  { name: "OpenAI", category: "AI", description: "AI/ML APIs" },
  { name: "Prisma", category: "ORM", description: "Database toolkit" },
  { name: "tRPC", category: "API", description: "End-to-end typesafe APIs" },
];

const categoryColors: Record<string, string> = {
  Framework: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  Library: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  Language: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  Styling: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
  Runtime: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  Database: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
  Cache: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  Hosting: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  Payments: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  AI: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/20",
  ORM: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  API: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
};

export function TechStackDisplay() {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Our Tech Stack</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Modern technologies powering the Reliverse ecosystem
          </p>
        </div>

        <TooltipProvider>
          <div className="flex flex-wrap justify-center gap-3">
            {techStack.map((tech) => (
              <Tooltip key={tech.name}>
                <TooltipTrigger>
                  <Badge
                    className={`cursor-default px-4 py-2 text-sm transition-transform hover:scale-105 ${categoryColors[tech.category]}`}
                    variant="outline"
                  >
                    {tech.name}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">{tech.name}</p>
                  <p className="text-xs text-muted-foreground">{tech.description}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>
    </section>
  );
}
