import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: () => new Response("Not found", { status: 404 }),
      POST: () => new Response("Not found", { status: 404 }),
    },
  },
});
