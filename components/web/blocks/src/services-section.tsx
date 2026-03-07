import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/card";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Cloud, Code2, Palette, Rocket, Shield, Smartphone } from "lucide-react";

const services = [
  {
    icon: Code2,
    title: "Custom Development",
    description:
      "Full-stack web and mobile application development using modern technologies like Next.js, React, and TypeScript.",
    features: ["Next.js / React", "TypeScript", "API Development", "Database Design"],
    popular: true,
  },
  {
    icon: Palette,
    title: "UI/UX Design",
    description:
      "Beautiful, accessible, and user-centered design systems that convert visitors into customers.",
    features: ["Design Systems", "Prototyping", "User Research", "A/B Testing"],
    popular: false,
  },
  {
    icon: Cloud,
    title: "Cloud Solutions",
    description:
      "Scalable cloud infrastructure setup and management with focus on performance and security.",
    features: ["AWS / Vercel", "CI/CD Pipelines", "Monitoring", "Auto-scaling"],
    popular: false,
  },
  {
    icon: Rocket,
    title: "Product Launch",
    description: "End-to-end product launch support from MVP to market with ongoing maintenance.",
    features: ["MVP Development", "Beta Testing", "Launch Strategy", "Analytics"],
    popular: true,
  },
  {
    icon: Smartphone,
    title: "Mobile Apps",
    description: "Cross-platform mobile applications using React Native with native performance.",
    features: ["React Native", "iOS & Android", "Push Notifications", "Offline Support"],
    popular: false,
  },
  {
    icon: Shield,
    title: "Security Audits",
    description: "Comprehensive security assessments and implementations for your applications.",
    features: ["Penetration Testing", "Code Review", "Compliance", "Auth Systems"],
    popular: false,
  },
];

export function ServicesSection() {
  return (
    <section className="bg-muted/30 py-20 sm:py-32" id="services">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Badge className="mb-4" variant="secondary">
            What We Offer
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Services & Expertise</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            From concept to deployment, we provide comprehensive solutions for your digital needs
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <Card
              className="group relative border-border/50 bg-card/50 backdrop-blur-sm transition-all hover:border-border hover:shadow-lg"
              key={service.title}
            >
              {service.popular && (
                <div className="absolute -top-3 right-4">
                  <Badge className="bg-accent text-accent-foreground">Popular</Badge>
                </div>
              )}
              <CardHeader>
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-accent/10 transition-colors group-hover:bg-accent/20">
                  <service.icon className="size-6 text-accent" />
                </div>
                <CardTitle className="text-xl">{service.title}</CardTitle>
                <CardDescription className="text-sm">{service.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {service.features.map((feature) => (
                    <li
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                      key={feature}
                    >
                      <div className="size-1.5 rounded-full bg-accent" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Button size="lg">
            <Link to="/contact">
              Get in Touch
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
