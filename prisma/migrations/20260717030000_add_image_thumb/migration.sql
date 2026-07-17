-- Durable thumbnail for Your Moments cards (data URL / base64 JPEG).
-- Full-size image_path may point at ephemeral /uploads or private object storage.
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "image_thumb" TEXT;
