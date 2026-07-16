-- AlterTable (idempotent for DBs that evolved via db push / partial deploys)
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "tracks" JSONB;
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "suggested_tracks" JSONB;
