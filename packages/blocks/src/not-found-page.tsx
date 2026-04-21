import { Button } from "@repo/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/card";
import type { NotFoundRouteProps } from "@tanstack/react-router";
import { Home, Search } from "lucide-react";

interface NotFoundPageProps {
  title?: string;
  description?: string;
}

export function NotFoundPage(_props: NotFoundRouteProps) {
  const title = "Page not found";
  const description = "The page you're looking for doesn't exist or has been moved.";

  const handleGoHome = () => {
    window.location.href = "/";
  };

  const handleSearch = () => {
    // Focus on the command menu if it exists
    const searchTrigger = document.querySelector("[data-command-menu-trigger]") as HTMLElement;
    if (searchTrigger) {
      searchTrigger.click();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <Search className="size-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={handleGoHome}>
              <Home className="mr-2 size-4" />
              Go Home
            </Button>
            <Button className="flex-1" onClick={handleSearch} variant="outline">
              <Search className="mr-2 size-4" />
              Search
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function NotFoundErrorPage({ title, description }: NotFoundPageProps = {}) {
  const finalTitle = title ?? "Page not found";
  const finalDescription =
    description ?? "The page you're looking for doesn't exist or has been moved.";
  const handleGoHome = () => {
    window.location.href = "/";
  };

  const handleSearch = () => {
    // Focus on the command menu if it exists
    const searchTrigger = document.querySelector("[data-command-menu-trigger]") as HTMLElement;
    if (searchTrigger) {
      searchTrigger.click();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <Search className="size-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">{finalTitle}</CardTitle>
          <CardDescription>{finalDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={handleGoHome}>
              <Home className="mr-2 size-4" />
              Go Home
            </Button>
            <Button className="flex-1" onClick={handleSearch} variant="outline">
              <Search className="mr-2 size-4" />
              Search
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
