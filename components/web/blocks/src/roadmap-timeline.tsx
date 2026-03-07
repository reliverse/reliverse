import { Badge } from "@repo/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/card";
import { CheckCircle2, Circle, Clock } from "lucide-react";

interface RoadmapItem {
  quarter: string;
  year: string;
  title: string;
  description: string;
  status: "completed" | "in-progress" | "upcoming";
  items: string[];
}

const roadmapData: RoadmapItem[] = [
  {
    quarter: "Q1",
    year: "2026",
    title: "Foundation",
    description: "Establishing core infrastructure and initial product releases",
    status: "completed",
    items: [
      "Launch Reliverse website",
      "Introduce Relivator v1.0",
      "Introduce Dler CLI",
      "Establish development guidelines",
    ],
  },
  {
    quarter: "Q2",
    year: "2026",
    title: "Expansion",
    description: "Growing the ecosystem with new products and features",
    status: "completed",
    items: [
      "Introduce Versator template",
      "Introduce Blefcoins system",
      "Community contribution program",
    ],
  },
  {
    quarter: "Q3",
    year: "2026",
    title: "Integration",
    description: "Connecting products and enhancing user experience",
    status: "in-progress",
    items: [
      "Cross-product authentication",
      "Unified dashboard",
      "API marketplace",
      "Enhanced documentation",
    ],
  },
  {
    quarter: "Q4",
    year: "2026",
    title: "Scale",
    description: "Scaling infrastructure and launching major products",
    status: "upcoming",
    items: ["Mobile applications", "Enterprise solutions"],
  },
  {
    quarter: "Q1",
    year: "2027",
    title: "Innovation",
    description: "Next-generation features and new product categories",
    status: "upcoming",
    items: ["AI-powered development tools", "Global expansion"],
  },
];

const statusConfig = {
  completed: {
    icon: CheckCircle2,
    color: "text-emerald-500",
    badge: "Completed",
    badgeVariant: "default" as const,
  },
  "in-progress": {
    icon: Clock,
    color: "text-amber-500",
    badge: "In Progress",
    badgeVariant: "secondary" as const,
  },
  upcoming: {
    icon: Circle,
    color: "text-muted-foreground",
    badge: "Upcoming",
    badgeVariant: "outline" as const,
  },
};

export function RoadmapTimeline() {
  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute top-0 left-8 hidden h-full w-px bg-border md:block" />

      <div className="space-y-8">
        {roadmapData.map((item, index) => {
          const config = statusConfig[item.status];
          const Icon = config.icon;

          return (
            <div className="relative flex gap-6" key={index}>
              {/* Timeline dot */}
              <div className="hidden md:flex">
                <div
                  className={`relative z-10 flex size-16 shrink-0 items-center justify-center rounded-full border bg-background ${config.color}`}
                >
                  <Icon className="size-6" />
                </div>
              </div>

              {/* Content */}
              <Card className="flex-1 border-border/50 bg-card/50 backdrop-blur-sm">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={config.badgeVariant}>{config.badge}</Badge>
                    <span className="text-sm font-medium text-muted-foreground">
                      {item.quarter} {item.year}
                    </span>
                  </div>
                  <CardTitle className="text-xl">{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {item.items.map((listItem, itemIndex) => (
                      <li
                        className="flex items-center gap-2 text-sm text-muted-foreground"
                        key={itemIndex}
                      >
                        {item.status === "completed" ? (
                          <CheckCircle2 className="size-4 text-emerald-500" />
                        ) : (
                          <Circle className="size-4" />
                        )}
                        {listItem}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
