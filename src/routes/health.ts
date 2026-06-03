import type { FastifyInstance } from "fastify";
import { ok } from "../lib/response.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () =>
    ok({
      status: "ok",
      time: new Date().toISOString()
    })
  );
}
