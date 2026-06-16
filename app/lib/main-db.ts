import { Pool } from "pg";

let pool: Pool | null = null;

// Replace ambiguous sslmode values with the explicit equivalent so pg doesn't
// emit a deprecation warning about their meaning changing in pg v9.
function normalizeConnStr(url: string | undefined): string | undefined {
  return url?.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
}

export function getMainDb(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: normalizeConnStr(process.env.MAIN_DATABASE_URL),
      max: 5,
    });
  }
  return pool;
}
