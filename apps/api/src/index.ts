import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: process.env.NEXT_PUBLIC_API_URL ?? "*" }));

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, () => {
  console.log(`API running on http://localhost:${port}`);
});

export default app;
