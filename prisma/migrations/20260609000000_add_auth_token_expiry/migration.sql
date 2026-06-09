-- Add expiry timestamp for server-side auth (session) tokens
ALTER TABLE "User" ADD COLUMN "authTokenExpiry" TIMESTAMP(3);
