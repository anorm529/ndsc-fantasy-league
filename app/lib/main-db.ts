import { Pool } from "pg";

let pool: Pool | null = null;

export function getMainDb(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.MAIN_DATABASE_URL,
      max: 5,
    });
  }
  return pool;
}
