-- A patient who does not show up is re-queued once; a second miss removes them.
ALTER TABLE "Token" ADD COLUMN "missedCount" INTEGER NOT NULL DEFAULT 0;
