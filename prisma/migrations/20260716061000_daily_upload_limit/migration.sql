-- Replace token balance with per-user daily upload quota.
-- Premium users still bypass the limit via tier === 'premium'.
-- Raise a free user's cap anytime: UPDATE users SET daily_upload_limit = 20 WHERE email = '...';

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_upload_limit" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "users" DROP COLUMN IF EXISTS "tokens";
