/**
 * Ensures critical schema columns exist before traffic is served.
 * Production historically used `db push`; redeploys can ship Prisma client
 * fields before `migrate deploy` has been applied. These statements are
 * idempotent (IF NOT EXISTS).
 */
export async function ensureGenerationTrackColumns(db) {
  await db.$executeRawUnsafe(
    'ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "tracks" JSONB'
  );
  await db.$executeRawUnsafe(
    'ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "suggested_tracks" JSONB'
  );
}
