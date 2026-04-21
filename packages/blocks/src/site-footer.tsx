import { Separator } from "@repo/ui/separator";
import { Link } from "@tanstack/react-router";
import { Rss } from "lucide-react";

const footerLinks = {
  Products: [
    { label: "Reliverse", href: "https://reliverse.org" },
    { label: "Relivator", href: "https://relivator.com" },
    { label: "Rse CLI", href: "https://wiki.reliverse.org/docs/libraries/rse" },
    { label: "Dler", href: "https://wiki.reliverse.org/docs/libraries/dler-rse-plugin" },
  ],
  Community: [{ label: "Discord", href: "#" }],
  Resources: [
    { label: "Blog", href: "/blog" },
    { label: "Roadmap", href: "/roadmap" },
    { label: "Compare", href: "/compare" },
    { label: "RSS Feed", href: "/feed.xml" },
  ],
  Company: [
    { label: "About", href: "/#about" },
    { label: "Team", href: "/#team" },
    { label: "Contact", href: "/contact" },
    { label: "Careers", href: "#" },
  ],
};

export function SiteFooter() {
  return (
    <footer className="border-t border-border/40 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Link className="flex items-center gap-2" to="/">
              <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
                <span className="text-sm font-bold">B</span>
              </div>
              <span className="text-lg font-semibold tracking-tight">Reliverse</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Building the future of digital products. An innovative tech ecosystem spanning gaming,
              commerce, and developer tools.
            </p>
            <a
              className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              href="/feed.xml"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Rss className="size-4" />
              Subscribe via RSS
            </a>
          </div>

          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="mb-3 text-sm font-semibold text-foreground">{category}</h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("http") || link.href.startsWith("#") ? (
                      <a
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                        href={link.href}
                        {...(link.href.startsWith("http") && {
                          target: "_blank",
                          rel: "noopener noreferrer",
                        })}
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                        to={link.href}
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Reliverse. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <a
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              href="https://github.com/blefnk"
              rel="noopener noreferrer"
              target="_blank"
            >
              GitHub
            </a>
            <a
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              href="https://twitter.com/blefnk"
              rel="noopener noreferrer"
              target="_blank"
            >
              Twitter
            </a>
            <a
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              href="https://linkedin.com/company/reliverse"
              rel="noopener noreferrer"
              target="_blank"
            >
              LinkedIn
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
