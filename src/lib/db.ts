import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Standard Next.js singleton pattern to prevent multiple connections in development
const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };

export const getPrismaClient = (): PrismaClient => {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);

  const client = new PrismaClient({ adapter });

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = client;
  }

  return globalForPrisma.prisma;
};

export const prisma = getPrismaClient();
export default prisma;
