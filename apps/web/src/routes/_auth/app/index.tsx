import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/app/")({
  component: AppPlaceholder,
});

function AppPlaceholder() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-semibold">No authenticated app surface in Reliverse</h2>
      <p className="max-w-xl text-sm text-foreground/80">
        This monorepo now focuses on developer tools and landing pages. Product-facing authenticated UI
        moved out to Bleverse.
      </p>
      <Link to="/" className="underline underline-offset-4">
        Back to home
      </Link>
    </div>
  );
}
