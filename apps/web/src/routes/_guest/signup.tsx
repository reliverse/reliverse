import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_guest/signup")({
  component: SignupPlaceholder,
});

function SignupPlaceholder() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
      <h1 className="text-2xl font-semibold">Signup removed from Reliverse</h1>
      <p className="text-sm text-foreground/80">
        Bleverse now owns end-user auth and social features. Reliverse keeps the developer tooling
        experience leaner.
      </p>
      <div className="text-sm">
        <Link to="/" className="underline underline-offset-4">
          Back to home
        </Link>
      </div>
    </div>
  );
}
