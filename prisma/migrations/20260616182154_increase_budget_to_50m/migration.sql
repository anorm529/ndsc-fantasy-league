/*
  Warnings:

  - Made the column `processed_game_id` on table `fantasy_price_history` required. This step will fail if there are existing NULL values in that column.
  - Made the column `processed_game_id` on table `fantasy_scores` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "fantasy_player_meta_player_id_key";

-- DropIndex
DROP INDEX "fantasy_teams_fantasy_user_id_key";

-- AlterTable
ALTER TABLE "fantasy_awards" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fantasy_leagues" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fantasy_ownership_history" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fantasy_price_history" ALTER COLUMN "processed_game_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "fantasy_processed_games" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fantasy_scores" ALTER COLUMN "processed_game_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "fantasy_teams" ALTER COLUMN "current_budget" SET DEFAULT 50.0;

-- AlterTable
ALTER TABLE "fantasy_transfer_trends" ALTER COLUMN "id" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "fantasy_ownership_history_player_id_league_id_processed_game_id" RENAME TO "fantasy_ownership_history_player_id_league_id_processed_gam_key";

-- RenameIndex
ALTER INDEX "fantasy_transfer_trends_player_id_league_id_processed_game_id_k" RENAME TO "fantasy_transfer_trends_player_id_league_id_processed_game__key";
