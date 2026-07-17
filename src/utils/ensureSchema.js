/**
 * Ensures critical schema columns exist before traffic is served.
 * Production historically used `db push`; redeploys can ship Prisma client
 * fields before `migrate deploy` has been applied. These statements are
 * idempotent (IF NOT EXISTS).
 */
export async function ensureSchema(db) {
  await db.$executeRawUnsafe(
    'ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "tracks" JSONB'
  );
  await db.$executeRawUnsafe(
    'ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "suggested_tracks" JSONB'
  );
  await db.$executeRawUnsafe(
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_upload_limit" INTEGER NOT NULL DEFAULT 3'
  );
  await db.$executeRawUnsafe(
    'ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "image_thumb" TEXT'
  );
  // Drop legacy token balance if present (ignore errors on fresh DBs)
  try {
    await db.$executeRawUnsafe('ALTER TABLE "users" DROP COLUMN IF EXISTS "tokens"');
  } catch (err) {
    console.warn('[Prisma] Could not drop users.tokens:', err.message);
  }
}

/** @deprecated use ensureSchema */
export const ensureGenerationTrackColumns = ensureSchema;
