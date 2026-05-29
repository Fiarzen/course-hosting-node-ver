import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL is injected at runtime by Railway, but is NOT present during
// the Docker build step (`prisma generate`). The `env()` helper from
// `prisma/config` throws when the variable is missing, which fails the build.
// `prisma generate` does not open a connection, so fall back to a
// syntactically valid placeholder; `migrate deploy` runs at runtime when the
// real DATABASE_URL is available. Runtime PrismaClient uses the PrismaPg
// adapter in src/db.ts regardless.
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
