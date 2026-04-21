"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/avatar";
import { Button } from "@repo/ui/button";
import { Card, CardContent } from "@repo/ui/card";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";
import { useEffect, useState } from "react";

const testimonials = [
  {
    id: 1,
    content:
      "Reliverse developer tools have transformed our workflow. The Relivator template saved us months of development time.",
    author: "Damon Hume",
    role: "CTO",
    avatar: "/professional-man-avatar.png",
    company: "Amitohume",
  },
  {
    id: 2,
    content:
      "The attention to detail in every Reliverse product is remarkable. Their ecosystem approach means everything works together seamlessly.",
    author: "Lydie Orris",
    role: "Lead Developer",
    avatar: "/engineer-woman-avatar.jpg",
    company: "ReMind Corp",
  },
  {
    id: 3,
    content:
      "Dler has become an essential part of our TypeScript library development. Clean, fast, and incredibly well-documented.",
    author: "Marcus Harris",
    role: "Open Source Maintainer",
    avatar: "/professional-man-avatar.png",
    company: "Orentosh OSS Group",
  },
  {
    id: 4,
    content:
      "The Reliverse platform is a really good thing. The integration capabilities are exactly what we needed.",
    author: "Anaїs",
    role: "Software Engineer",
    avatar: "/engineer-woman-avatar.jpg",
    company: "MNT Engine",
  },
];

export function TestimonialsSection() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  useEffect(() => {
    if (!isAutoPlaying) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % testimonials.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [isAutoPlaying]);

  const goToPrevious = () => {
    setIsAutoPlaying(false);
    setCurrentIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  const goToNext = () => {
    setIsAutoPlaying(false);
    setCurrentIndex((prev) => (prev + 1) % testimonials.length);
  };

  const currentTestimonial = testimonials[currentIndex] ?? testimonials[0];

  if (!currentTestimonial) return null;

  return (
    <section className="py-20 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Trusted by Developers</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            See what the community says about our products
          </p>
        </div>

        <div className="relative mx-auto max-w-3xl">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-8 sm:p-12">
              <Quote className="mb-6 size-10 text-accent/30" />
              <blockquote className="mb-8 text-xl leading-relaxed text-foreground sm:text-2xl">
                "{currentTestimonial.content}"
              </blockquote>
              <div className="flex items-center gap-4">
                <Avatar className="size-12">
                  <AvatarImage
                    alt={currentTestimonial.author}
                    src={currentTestimonial.avatar || "/placeholder.svg"}
                  />
                  <AvatarFallback>
                    {currentTestimonial.author
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold">{currentTestimonial.author}</div>
                  <div className="text-sm text-muted-foreground">
                    {currentTestimonial.role} at {currentTestimonial.company}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="mt-8 flex items-center justify-center gap-4">
            <Button
              aria-label="Previous testimonial"
              onClick={goToPrevious}
              size="icon"
              variant="outline"
            >
              <ChevronLeft className="size-4" />
            </Button>

            <div className="flex gap-2">
              {testimonials.map((_, index) => (
                <button
                  aria-label={`Go to testimonial ${index + 1}`}
                  className={`size-2 rounded-full transition-all ${
                    index === currentIndex
                      ? "w-6 bg-accent"
                      : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                  key={index}
                  onClick={() => {
                    setIsAutoPlaying(false);
                    setCurrentIndex(index);
                  }}
                />
              ))}
            </div>

            <Button aria-label="Next testimonial" onClick={goToNext} size="icon" variant="outline">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
