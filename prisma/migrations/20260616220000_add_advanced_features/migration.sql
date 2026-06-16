-- FantasyOwnershipHistory
CREATE TABLE "fantasy_ownership_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "processed_game_id" UUID NOT NULL,
    "ownership_percentage" DECIMAL(5,2) NOT NULL,
    "manager_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fantasy_ownership_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fantasy_ownership_history_player_id_league_id_processed_game_id_key"
    ON "fantasy_ownership_history"("player_id", "league_id", "processed_game_id");

ALTER TABLE "fantasy_ownership_history"
    ADD CONSTRAINT "fantasy_ownership_history_league_id_fkey"
    FOREIGN KEY ("league_id") REFERENCES "fantasy_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fantasy_ownership_history"
    ADD CONSTRAINT "fantasy_ownership_history_processed_game_id_fkey"
    FOREIGN KEY ("processed_game_id") REFERENCES "fantasy_processed_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FantasyTransferTrends
CREATE TABLE "fantasy_transfer_trends" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "processed_game_id" UUID NOT NULL,
    "transfers_in" INTEGER NOT NULL DEFAULT 0,
    "transfers_out" INTEGER NOT NULL DEFAULT 0,
    "net_transfers" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fantasy_transfer_trends_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fantasy_transfer_trends_player_id_league_id_processed_game_id_key"
    ON "fantasy_transfer_trends"("player_id", "league_id", "processed_game_id");

ALTER TABLE "fantasy_transfer_trends"
    ADD CONSTRAINT "fantasy_transfer_trends_league_id_fkey"
    FOREIGN KEY ("league_id") REFERENCES "fantasy_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fantasy_transfer_trends"
    ADD CONSTRAINT "fantasy_transfer_trends_processed_game_id_fkey"
    FOREIGN KEY ("processed_game_id") REFERENCES "fantasy_processed_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FantasyAward
CREATE TABLE "fantasy_awards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "league_id" UUID NOT NULL,
    "award_name" TEXT NOT NULL,
    "winner_team_id" UUID,
    "winner_player_id" UUID,
    "value" TEXT NOT NULL,
    "details" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fantasy_awards_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "fantasy_awards"
    ADD CONSTRAINT "fantasy_awards_league_id_fkey"
    FOREIGN KEY ("league_id") REFERENCES "fantasy_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
