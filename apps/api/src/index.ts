import { serve } from "bun";

const port = Number(process.env.PORT ?? 3001);
const service = "reliverse-api";

serve({
  port,
  fetch(req) {
    const u = new URL(req.url);
    const host = req.headers.get("host") ?? "unknown";

    if (u.pathname === "/health") {
      return Response.json({ ok: true, service, port, host });
    }

    return Response.json({ ok: true, service, path: u.pathname, host, port });
  },
});

console.log(`⚡️ [${service}] http://localhost:${port}/`);

/*

import { devToolsMiddleware } from "@ai-sdk/devtools";
import { google } from "@ai-sdk/google";
import { cors } from "@elysiajs/cors";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createContext } from "@repo/server/context";
import { appRouter } from "@repo/server/routers/index";
import { auth } from "@repo/auth";
import { env } from "@repo/env/api";
import { convertToModelMessages, streamText, type UIMessage, wrapLanguageModel } from "ai";
import { Elysia } from "elysia";

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});
const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

const corsConfig = {
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  ...(env.CORS_ORIGIN ? { origin: env.CORS_ORIGIN } : {}),
};

const app = new Elysia()
  .use(cors(corsConfig))
  .all("/api/auth/*", async (context) => {
    const { request, status } = context;
    if (["POST", "GET"].includes(request.method)) {
      return auth.handler(request);
    }
    return status(405);
  })
  .all("/rpc*", async (context) => {
    const { response } = await rpcHandler.handle(context.request, {
      prefix: "/rpc",
      context: await createContext({ context }),
    });
    return response ?? new Response("Not Found", { status: 404 });
  })
  .all("/api*", async (context) => {
    const { response } = await apiHandler.handle(context.request, {
      prefix: "/api-reference",
      context: await createContext({ context }),
    });
    return response ?? new Response("Not Found", { status: 404 });
  })
  .post("/ai", async (context) => {
    const body = (await context.request.json()) as { messages?: UIMessage[] };
    const uiMessages = body.messages || [];
    const model = wrapLanguageModel({
      model: google("gemini-2.5-flash"),
      middleware: devToolsMiddleware(),
    });
    const result = streamText({
      model,
      messages: await convertToModelMessages(uiMessages),
    });

    return result.toUIMessageStreamResponse();
  })
  .get("/", () => "OK")
  .listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
  });

*/
