import { cn } from "@repo/ui/utils/cn";
import { Button, buttonVariants } from "@repo/ui/button";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";

import { ScrollIndicator } from "./scroll-indicator";
import { TypewriterText } from "./typewriter-text";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-32">
      {/* Background gradient */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="size-[600px] rounded-full bg-accent/10 blur-3xl" />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/50 bg-secondary/50 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur-sm">
            <Sparkles className="size-4 text-accent" />
            Building the future of digital products
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Welcome to{" "}
            <span className="bg-linear-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              Reliverse
            </span>
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">
            An innovative tech ecosystem building{" "}
            <TypewriterText
              className="font-semibold text-foreground"
              texts={[
                "next-generation apps",
                "developer tools",
                "CLIs and libraries",
                "commerce solutions",
                "AI experiences",
              ]}
            />
            <br />
            From concept to deployment, we craft experiences that matter.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button nativeButton={false} size="lg">
              <a className="flex w-fit items-center gap-2" href="#projects">
                Reliverse Projects
                <ArrowRight className="ml-2 size-4" />
              </a>
            </Button>
            <Link
              className={cn(
                buttonVariants({
                  size: "lg",
                  variant: "outline",
                }),
              )}
              to="/blog/$"
            >
              Reliverse Blog
            </Link>
          </div>
        </div>

        {/* Stats with animated counters */}
        <div className="mt-20 grid grid-cols-2 gap-8 border-t border-border/50 pt-10 sm:grid-cols-4">
          <div className="flex flex-col items-center justify-center">
            <span className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              Projects
            </span>
            <span>25+</span>
          </div>
          <div>
            <span className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              Categories
            </span>
            <span>7</span>
          </div>
          <div>
            <span className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              Technologies
            </span>
            <span>50+</span>
          </div>
          <div>
            <span className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              Made with UX/DX in mind
            </span>
            <span>100%</span>
          </div>
        </div>
      </div>

      <ScrollIndicator />
    </section>
  );
}
