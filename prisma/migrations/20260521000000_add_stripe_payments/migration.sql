-- CreateEnum
CREATE TYPE "CoursePurchaseStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED');

-- AlterTable: add pricing fields to Course
ALTER TABLE "Course" ADD COLUMN "isPaid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Course" ADD COLUMN "priceCents" INTEGER;
ALTER TABLE "Course" ADD COLUMN "currency" TEXT;

-- CreateTable: CoursePurchase
CREATE TABLE "CoursePurchase" (
    "id" SERIAL NOT NULL,
    "status" "CoursePurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "checkoutSessionId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "stripeCustomerId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,

    CONSTRAINT "CoursePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable: StripeWebhookEvent
CREATE TABLE "StripeWebhookEvent" (
    "id" SERIAL NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoursePurchase_checkoutSessionId_key" ON "CoursePurchase"("checkoutSessionId");
CREATE INDEX "CoursePurchase_userId_courseId_idx" ON "CoursePurchase"("userId", "courseId");
CREATE INDEX "CoursePurchase_status_idx" ON "CoursePurchase"("status");
CREATE INDEX "CoursePurchase_checkoutSessionId_idx" ON "CoursePurchase"("checkoutSessionId");
CREATE INDEX "CoursePurchase_paymentIntentId_idx" ON "CoursePurchase"("paymentIntentId");
CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- AddForeignKey
ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
