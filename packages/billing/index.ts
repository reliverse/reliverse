import { Polar } from "@polar-sh/sdk";
import { env } from "@repo/env/api";

export const polar = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: (env.POLAR_MODE as never) || "sandbox",
});
