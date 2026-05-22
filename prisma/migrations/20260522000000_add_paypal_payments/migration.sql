-- Make checkoutSessionId nullable (Stripe-only field; PayPal purchases use paypalOrderId)
ALTER TABLE "CoursePurchase" ALTER COLUMN "checkoutSessionId" DROP NOT NULL;

-- Add PayPal fields
ALTER TABLE "CoursePurchase" ADD COLUMN "paymentMethod"   TEXT NOT NULL DEFAULT 'STRIPE';
ALTER TABLE "CoursePurchase" ADD COLUMN "paypalOrderId"   TEXT;
ALTER TABLE "CoursePurchase" ADD COLUMN "paypalCaptureId" TEXT;

-- Unique index for paypalOrderId (partial: only on non-null values)
CREATE UNIQUE INDEX "CoursePurchase_paypalOrderId_key"
  ON "CoursePurchase"("paypalOrderId")
  WHERE "paypalOrderId" IS NOT NULL;

-- Lookup indexes
CREATE INDEX "CoursePurchase_paymentMethod_idx" ON "CoursePurchase"("paymentMethod");
CREATE INDEX "CoursePurchase_paypalOrderId_idx"  ON "CoursePurchase"("paypalOrderId");
