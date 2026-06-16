-- AlterTable
ALTER TABLE "fantasy_leagues"
  ADD COLUMN "window_closes_at"     TIMESTAMP(3),
  ADD COLUMN "double_points_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "starting_budget"      DECIMAL(10,1) NOT NULL DEFAULT 50.0,
  ADD COLUMN "squad_size"           INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "max_players_per_team" INTEGER NOT NULL DEFAULT 3;
