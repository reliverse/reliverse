import { Card, CardContent } from "@repo/ui/card";
import { Code2, Globe, Users, Zap } from "lucide-react";

const features = [
  {
    icon: Code2,
    title: "Developer First",
    description:
      "Built by developers, for developers. Every product follows modern best practices and is designed for extensibility.",
  },
  {
    icon: Users,
    title: "Community Driven",
    description:
      "Our projects thrive on community contributions. Join us in building the future of digital products.",
  },
  {
    icon: Zap,
    title: "Performance Focused",
    description:
      "Every product is optimized for speed and efficiency, ensuring the best possible user experience.",
  },
  {
    icon: Globe,
    title: "Global Reach",
    description:
      "From Ukraine to the world, we build products that transcend borders and connect people.",
  },
];

export function AboutSection() {
  return (
    <section className="bg-muted/30 py-20 sm:py-32" id="about">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">About Reliverse</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            We're on a mission to build exceptional digital products that make a difference. Our
            ecosystem spans multiple domains, all connected by our commitment to quality and
            innovation.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm" key={feature.title}>
              <CardContent className="pt-6">
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-accent/10">
                  <feature.icon className="size-6 text-accent" />
                </div>
                <h3 className="mb-2 font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
