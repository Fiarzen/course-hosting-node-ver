-- Add email verification fields to User
ALTER TABLE "User" ADD COLUMN "emailVerified"                BOOLEAN   NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailVerificationToken"       TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerificationTokenExpiry" TIMESTAMP(3);
