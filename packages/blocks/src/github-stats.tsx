"use client";

import { Card, CardContent } from "@repo/ui/card";
import { Skeleton } from "@repo/ui/skeleton";
import { Code, GitFork, Star, Users } from "lucide-react";
import { useEffect, useState } from "react";

interface GitHubStats {
  stars: number;
  forks: number;
  contributors: number;
  repos: number;
}

export function GitHubStats() {
  const [stats, setStats] = useState<GitHubStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulated stats - in production, fetch from GitHub API
    const fetchStats = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setStats({
        stars: 2847,
        forks: 412,
        contributors: 89,
        repos: 25,
      });
      setLoading(false);
    };

    fetchStats();
  }, []);

  const statItems = [
    { icon: Star, label: "Stars", value: stats?.stars, color: "text-amber-500" },
    { icon: GitFork, label: "Forks", value: stats?.forks, color: "text-blue-500" },
    { icon: Users, label: "Contributors", value: stats?.contributors, color: "text-emerald-500" },
    { icon: Code, label: "Repositories", value: stats?.repos, color: "text-violet-500" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {statItems.map((item) => (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm" key={item.label}>
          <CardContent className="flex flex-col items-center p-6">
            <item.icon className={`mb-2 size-6 ${item.color}`} />
            {loading ? (
              <Skeleton className="mb-1 h-8 w-16" />
            ) : (
              <span className="text-2xl font-bold tabular-nums">
                {item.value?.toLocaleString()}
              </span>
            )}
            <span className="text-sm text-muted-foreground">{item.label}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
