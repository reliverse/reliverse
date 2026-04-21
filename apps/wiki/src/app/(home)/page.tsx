import Link from "next/link";
import { Syne } from "next/font/google";

const syne = Syne({
  subsets: ["latin"],
  display: "swap",
});

const linkClass =
  "hero-animate hero-animate-delay-3 inline-flex items-center justify-center rounded-lg bg-(--fd-primary) px-5 py-3 text-sm font-medium text-(--fd-primary-foreground) shadow-sm transition-colors hover:opacity-90 focus-visible:outline focus-visible:ring-2 focus-visible:ring-(--fd-ring) focus-visible:ring-offset-2";
const linkClassLore =
  "hero-animate hero-animate-delay-4 inline-flex items-center justify-center rounded-lg bg-(--fd-primary) px-5 py-3 text-sm font-medium text-(--fd-primary-foreground) shadow-sm transition-colors hover:opacity-90 focus-visible:outline focus-visible:ring-2 focus-visible:ring-(--fd-ring) focus-visible:ring-offset-2";

export default function HomePage() {
  return (
    <main
      className={`${syne.className} relative flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center overflow-hidden px-6`}
    >
      {/* Subtle radial gradient for depth */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4] dark:opacity-[0.12]"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, var(--fd-muted-foreground), transparent 55%)",
        }}
      />
      <div className="relative flex flex-col items-center text-center">
        <h1 className="hero-animate mb-5 text-4xl font-semibold tracking-tight text-(--fd-foreground) sm:text-5xl md:text-6xl">
          Reliverse
        </h1>
        <p className="hero-animate hero-animate-delay-1 mb-12 max-w-md text-base text-(--fd-muted-foreground) sm:text-lg">
          Calm, modular, built for creators.
        </p>
        <nav
          className="hero-animate hero-animate-delay-2 flex flex-wrap items-center justify-center gap-3"
          aria-label="Content"
        >
          <Link href="/docs" className={linkClass}>
            Docs
          </Link>
          <Link href="/blog" className={linkClass}>
            Blog
          </Link>
        </nav>
      </div>
    </main>
  );
}
