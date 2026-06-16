import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const g = globalThis as unknown as { __fantasyPrisma?: PrismaClient };

function normalizeConnStr(url: string): string {
  return url.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
}

function createClient() {
  const adapter = new PrismaPg({
    connectionString: normalizeConnStr(process.env.FANTASY_DATABASE_URL!),
    max: 2, // serverless: each function handles one request; 2 covers parallel queries
  });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

// Reuse the client across requests within the same warm function instance
// (both dev hot-reloads and production serverless warm starts).
export const db = g.__fantasyPrisma ?? createClient();
g.__fantasyPrisma = db;
