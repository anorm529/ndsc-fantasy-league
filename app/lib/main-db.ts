import { Pool } from "pg";

// globalThis survives hot-reloads in dev and is reused across requests
// within the same warm serverless function instance in production.
const g = globalThis as unknown as { __mainPool?: Pool };

function normalizeConnStr(url: string | undefined): string | undefined {
  return url?.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
}

export function getMainDb(): Pool {
  if (!g.__mainPool) {
    g.__mainPool = new Pool({
      connectionString: normalizeConnStr(process.env.MAIN_DATABASE_URL),
      max: 2, // serverless: each function handles one request; 2 covers parallel queries
    });
  }
  return g.__mainPool;
}
