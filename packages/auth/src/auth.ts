import "@tanstack/react-start/server-only";
import { expo } from "@better-auth/expo";
import { checkout, polar as polarPlugin, portal } from "@polar-sh/better-auth";
import { db } from "@repo/db";
import * as schema from "@repo/db/schema";
import { env } from "@repo/env/api";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { polarClient } from "./lib/payments";

export const auth = betterAuth({
  baseURL: process.env.VITE_BASE_URL,
  secret: process.env.SERVER_AUTH_SECRET,
  telemetry: {
    enabled: false,
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  trustedOrigins: [env.CORS_ORIGIN!, "mybettertapp://", "exp://"],
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.SERVER_GITHUB_CLIENT_ID!,
      clientSecret: process.env.SERVER_GITHUB_CLIENT_SECRET!,
    },
    google: {
      clientId: process.env.SERVER_GOOGLE_CLIENT_ID!,
      clientSecret: process.env.SERVER_GOOGLE_CLIENT_SECRET!,
    },
  },
  experimental: {
    joins: true,
  },
  plugins: [
    tanstackStartCookies(),
    polarPlugin({
      client: polarClient,
      createCustomerOnSignUp: false,
      enableCustomerPortal: true,
      use: [
        checkout({
          products: [
            {
              productId: "your-product-id",
              slug: "pro",
            },
          ],
          successUrl: env.POLAR_SUCCESS_URL || "http://localhost:3000/app",
          authenticatedUsersOnly: true,
        }),
        portal(),
      ],
    }),
    expo(),
  ],
});
