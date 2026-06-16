-- Drop existing data tied to gameweeks (test data only)
DELETE FROM fantasy_scores;
DELETE FROM fantasy_price_history;

-- Drop gameweeks table and its constraints
DROP TABLE IF EXISTS fantasy_gameweeks CASCADE;

-- Create fantasy_processed_games
CREATE TABLE "fantasy_processed_games" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score_count" INTEGER NOT NULL DEFAULT 0,
    "price_changes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fantasy_processed_games_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fantasy_processed_games_league_id_game_id_key"
    ON "fantasy_processed_games"("league_id", "game_id");

ALTER TABLE "fantasy_processed_games"
    ADD CONSTRAINT "fantasy_processed_games_league_id_fkey"
    FOREIGN KEY ("league_id") REFERENCES "fantasy_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Update fantasy_scores: swap gameweek_id for processed_game_id
ALTER TABLE "fantasy_scores" DROP CONSTRAINT IF EXISTS "fantasy_scores_player_id_gameweek_id_key";
ALTER TABLE "fantasy_scores" DROP COLUMN IF EXISTS "gameweek_id";
ALTER TABLE "fantasy_scores" ADD COLUMN "processed_game_id" UUID;
-- Existing rows were cleared above, so no backfill needed
ALTER TABLE "fantasy_scores" ADD CONSTRAINT "fantasy_scores_processed_game_id_fkey"
    FOREIGN KEY ("processed_game_id") REFERENCES "fantasy_processed_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "fantasy_scores_player_id_processed_game_id_key"
    ON "fantasy_scores"("player_id", "processed_game_id");

-- Update fantasy_price_history: swap gameweek_id for processed_game_id
ALTER TABLE "fantasy_price_history" DROP COLUMN IF EXISTS "gameweek_id";
ALTER TABLE "fantasy_price_history" ADD COLUMN "processed_game_id" UUID;
ALTER TABLE "fantasy_price_history" ADD CONSTRAINT "fantasy_price_history_processed_game_id_fkey"
    FOREIGN KEY ("processed_game_id") REFERENCES "fantasy_processed_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
