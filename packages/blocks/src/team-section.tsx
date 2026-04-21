import { Badge } from "@repo/ui/badge";
import { Card, CardContent } from "@repo/ui/card";
import { Github, Globe, Twitter } from "lucide-react";

const team = [
  {
    name: "Nazar Kornienko",
    role: "Lead Developer",
    handle: "blefnk",
    bio: "Full-stack developer and the visionary behind Reliverse. Building the future one commit at a time.",
    image: "/placeholder.svg?height=200&width=200",
    links: {
      website: "https://blefnk.reliverse.org",
      github: "https://github.com/blefnk",
      twitter: "https://twitter.com/blefnk",
    },
  },
  {
    name: "Petro Melnyk",
    role: "Developer & Musician",
    handle: "mfpiano",
    bio: "Developer and musician bringing creativity to code. Combining technical expertise with artistic vision.",
    image: "/placeholder.svg?height=200&width=200",
    links: {
      website: "https://mfs.reliverse.org",
      github: "#",
      twitter: "#",
    },
  },
];

export function TeamSection() {
  return (
    <section className="py-20 sm:py-32" id="team">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Meet the Team</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            The talented individuals behind the Reliverse ecosystem.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-4xl gap-8 sm:grid-cols-2">
          {team.map((member) => (
            <Card className="overflow-hidden border-border/50" key={member.handle}>
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-full">
                    <img
                      alt={member.name}
                      className="h-full w-full object-cover"
                      height={80}
                      src={member.image || "/placeholder.svg"}
                      width={80}
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{member.name}</h3>
                    <Badge className="mt-1" variant="secondary">
                      {member.role}
                    </Badge>
                    <p className="mt-3 text-sm text-muted-foreground">{member.bio}</p>
                    <div className="mt-4 flex items-center gap-3">
                      <a
                        aria-label={`${member.name}'s website`}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        href={member.links.website}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <Globe className="size-4" />
                      </a>
                      <a
                        aria-label={`${member.name}'s GitHub`}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        href={member.links.github}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <Github className="size-4" />
                      </a>
                      <a
                        aria-label={`${member.name}'s Twitter`}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        href={member.links.twitter}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <Twitter className="size-4" />
                      </a>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
