import { cn } from "@repo/ui-utils/cn";
import { Badge } from "@repo/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@repo/ui/tooltip";

interface ProjectStatusBadgeProps {
  status: "live" | "beta" | "development" | "concept";
  showTooltip?: boolean;
  className?: string;
}

const statusConfig = {
  live: {
    label: "Live",
    description: "This project is live and available for use",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    dotColor: "bg-emerald-500",
  },
  beta: {
    label: "Beta",
    description: "This project is in beta testing phase",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    dotColor: "bg-amber-500",
  },
  development: {
    label: "In Development",
    description: "This project is currently being developed",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    dotColor: "bg-blue-500",
  },
  concept: {
    label: "Concept",
    description: "This project is in the concept/planning phase",
    className: "bg-muted text-muted-foreground border-border",
    dotColor: "bg-muted-foreground",
  },
};

export function ProjectStatusBadge({
  status,
  showTooltip = true,
  className,
}: ProjectStatusBadgeProps) {
  const config = statusConfig[status];

  const badge = (
    <Badge
      className={cn("gap-1.5 text-[10px] tracking-wider uppercase", config.className, className)}
      variant="outline"
    >
      <span className={cn("size-1.5 rounded-full", config.dotColor)} />
      {config.label}
    </Badge>
  );

  if (!showTooltip) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>{badge}</TooltipTrigger>
        <TooltipContent>
          <p>{config.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
