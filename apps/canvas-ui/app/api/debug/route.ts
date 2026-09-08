import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export async function GET(req: NextRequest) {
  const apiKey = process.env.RUNTIME_API_KEY;
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // Constant-time compare — prevents timing oracle attacks
  const authorized =
    apiKey &&
    provided.length > 0 &&
    provided.length === apiKey.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(apiKey));

  if (!authorized) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return Response.json({
    WORKER_BASE_URL: process.env.WORKER_BASE_URL ? "SET" : "NOT SET",
    NODE_ENV: process.env.NODE_ENV || "NOT SET",
    REDIS_URL: process.env.REDIS_URL ? "SET (hidden)" : "NOT SET",
  });
}
