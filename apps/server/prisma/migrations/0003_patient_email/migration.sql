-- Optional patient email, and which queue-position emails a token has already received.
-- Written to be safe on databases that ran an earlier draft of this change.
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Token" ADD COLUMN IF NOT EXISTS "notified2" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Token" ADD COLUMN IF NOT EXISTS "notified1" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Token" DROP COLUMN IF EXISTS "notifyBySms";
