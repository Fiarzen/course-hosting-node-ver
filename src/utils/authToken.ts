import crypto from "crypto";
import { prisma } from "../db";

// Auth tokens are high-entropy UUIDs, so an unsalted SHA-256 is enough to make
// a leaked User table useless for session hijacking. The client always holds
// the raw token; only the hash is stored.
export function hashAuthToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

// Resolve a bearer token to its user. Sessions issued before hashing landed
// stored the raw token, so fall back to a plaintext lookup and upgrade the row
// in place — the stored plaintext disappears on first use. A stored hash can
// never be replayed as a bearer token: hashes are 64-char hex and are excluded
// from the fallback.
export async function findUserByAuthToken(token: string) {
  const user = await prisma.user.findUnique({
    where: { authToken: hashAuthToken(token) },
  });
  if (user) return user;

  if (SHA256_HEX.test(token)) return null;

  const legacy = await prisma.user.findUnique({ where: { authToken: token } });
  if (!legacy) return null;

  await prisma.user.update({
    where: { id: legacy.id },
    data: { authToken: hashAuthToken(token) },
  });
  return legacy;
}
