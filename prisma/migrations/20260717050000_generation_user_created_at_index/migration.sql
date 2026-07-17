-- Supports daily upload limits and recent-generation history queries.
CREATE INDEX IF NOT EXISTS "generations_user_id_created_at_idx"
ON "generations"("user_id", "created_at");
