import { Card, CardContent, CardHeader } from "@repo/ui/card";
import { Skeleton } from "@repo/ui/skeleton";

export function ProjectCardSkeleton() {
  return (
    <Card className="overflow-hidden border-border/50">
      <Skeleton className="aspect-video w-full" />
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent className="pt-0">
        <Skeleton className="mb-4 h-10 w-full" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ProjectGridSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <ProjectCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ProjectPageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Skeleton className="mb-8 h-4 w-48" />
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <div className="flex flex-col justify-center space-y-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </div>
  );
}

export function BlogCardSkeleton() {
  return (
    <Card className="overflow-hidden border-border/50">
      <Skeleton className="aspect-video w-full" />
      <CardHeader className="pb-3">
        <Skeleton className="mb-2 h-5 w-20" />
        <Skeleton className="h-6 w-full" />
      </CardHeader>
      <CardContent className="pt-0">
        <Skeleton className="mb-4 h-12 w-full" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}
