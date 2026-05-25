"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const globalForPrisma = global;
if (!globalForPrisma.pool) {
    globalForPrisma.pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
}
exports.prisma = globalForPrisma.prisma ||
    new client_1.PrismaClient({
        adapter: new adapter_pg_1.PrismaPg(globalForPrisma.pool),
        log: ["error", "warn"],
    });
if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = exports.prisma;
}
