import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function normalizeConnStr(url: string): string {
  return url.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
}

function createClient() {
  const adapter = new PrismaPg({
    connectionString: normalizeConnStr(process.env.FANTASY_DATABASE_URL!),
  });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
