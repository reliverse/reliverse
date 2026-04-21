import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_guest")({
  component: Outlet,
  beforeLoad: () => ({ redirectUrl: "/" }),
});
