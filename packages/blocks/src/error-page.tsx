import { Button } from "@repo/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/card";
import { isNotFound } from "@tanstack/react-router";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

import { NotFoundErrorPage } from "./not-found-page";

interface ErrorPageProps {
  error?: Error;
  title?: string;
  description?: string;
  showErrorDetails?: boolean;
}

export function ErrorPage({
  error,
  title = "Something went wrong",
  description = "We encountered an unexpected error. This might be a temporary issue.",
  showErrorDetails = process.env.NODE_ENV === "development",
}: ErrorPageProps) {
  // If this is a notFound error, render the NotFoundErrorPage instead
  if (error && isNotFound(error)) {
    return <NotFoundErrorPage />;
  }

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    window.location.href = "/";
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showErrorDetails && error && (
            <div className="rounded-md bg-muted p-3">
              <p className="text-sm font-medium text-muted-foreground">Error details:</p>
              <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={handleRefresh}>
              <RefreshCw className="mr-2 size-4" />
              Try Again
            </Button>
            <Button className="flex-1" onClick={handleGoHome} variant="outline">
              <Home className="mr-2 size-4" />
              Go Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
