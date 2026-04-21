"use client";

import { Button } from "@repo/ui/button";
import { Card, CardContent } from "@repo/ui/card";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      // Delay showing banner for better UX
      const timeout = setTimeout(() => setShowBanner(true), 2000);
      return () => clearTimeout(timeout);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem("cookie-consent", "accepted");
    setShowBanner(false);
  };

  const declineCookies = () => {
    localStorage.setItem("cookie-consent", "declined");
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed right-4 bottom-4 left-4 z-50 sm:left-auto sm:max-w-md">
      <Card className="border-border/50 bg-card/95 shadow-lg backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="mb-3 flex items-start justify-between">
            <h3 className="font-semibold">Cookie Preferences</h3>
            <Button className="size-6" onClick={declineCookies} size="icon" variant="ghost">
              <X className="size-4" />
            </Button>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            We use cookies to enhance your browsing experience and analyze site traffic. By clicking
            "Accept", you consent to our use of cookies.
          </p>
          <div className="flex gap-2">
            <Button onClick={acceptCookies} size="sm">
              Accept
            </Button>
            <Button onClick={declineCookies} size="sm" variant="outline">
              Decline
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
