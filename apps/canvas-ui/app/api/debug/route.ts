export async function GET() {
  return Response.json({
    WORKER_BASE_URL: process.env.WORKER_BASE_URL || "NOT SET",
    NODE_ENV: process.env.NODE_ENV || "NOT SET",
    REDISHOST: process.env.REDISHOST || "NOT SET",
    REDIS_URL: process.env.REDIS_URL ? "SET (hidden)" : "NOT SET",
  });
}

