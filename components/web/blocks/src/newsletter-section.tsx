"use client";

import { Button } from "@repo/ui/button";
import { Card, CardContent } from "@repo/ui/card";
import { Input } from "@repo/ui/input";
import { CheckCircle2, Mail } from "lucide-react";
import type React from "react";
import { useState } from "react";

export function NewsletterSection() {
  const [email, setEmail] = useState("");
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate subscription
    setIsSubscribed(true);
    setEmail("");
  };

  return (
    <section className="bg-muted/30 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Card className="mx-auto max-w-2xl border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="p-8 text-center sm:p-12">
            <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-accent/10">
              <Mail className="size-7 text-accent" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Stay Updated</h2>
            <p className="mt-3 text-muted-foreground">
              Get notified about new projects, releases, and updates from the Reliverse ecosystem.
            </p>

            {isSubscribed ? (
              <div className="mt-8 flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-5" />
                <span>Thanks for subscribing!</span>
              </div>
            ) : (
              <form className="mt-8 flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
                <Input
                  className="flex-1"
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  type="email"
                  value={email}
                />
                <Button type="submit">Subscribe</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
