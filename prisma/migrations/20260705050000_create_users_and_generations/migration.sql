-- CreateTable
CREATE TABLE "users" (
    "spotify_id" TEXT NOT NULL,
    "display_name" TEXT,
    "email" TEXT,
    "spotify_access_token" TEXT,
    "spotify_refresh_token" TEXT,
    "spotify_token_expires_at" BIGINT,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "tokens" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("spotify_id")
);

-- CreateTable
CREATE TABLE "generations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "image_path" TEXT NOT NULL,
    "dominant_colors" TEXT NOT NULL,
    "environmental_context" TEXT,
    "emotional_vibe" TEXT,
    "seed_genres" TEXT NOT NULL,
    "valence" DOUBLE PRECISION NOT NULL,
    "energy" DOUBLE PRECISION NOT NULL,
    "acousticness" DOUBLE PRECISION NOT NULL,
    "playlist_id" TEXT,
    "playlist_name" TEXT,
    "playlist_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("spotify_id") ON DELETE CASCADE ON UPDATE CASCADE;
