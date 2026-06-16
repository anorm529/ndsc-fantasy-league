-- CreateTable: FantasyLeague
CREATE TABLE "fantasy_leagues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "main_season_id" UUID NOT NULL,
    "prev_season_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fantasy_leagues_pkey" PRIMARY KEY ("id")
);

-- Insert a bootstrap league for any existing rows
INSERT INTO "fantasy_leagues" ("id", "name", "main_season_id", "status")
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'NDSC Fantasy 2026',
    '950338e2-56e2-449a-85a2-f6a6da9a0e15',
    'active'
);

-- AlterTable fantasy_teams: add league_id (nullable first, populate, then constrain)
ALTER TABLE "fantasy_teams" ADD COLUMN "league_id" UUID;
UPDATE "fantasy_teams" SET "league_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "fantasy_teams" ALTER COLUMN "league_id" SET NOT NULL;
ALTER TABLE "fantasy_teams" DROP COLUMN IF EXISTS "season";

-- AlterTable fantasy_gameweeks: add league_id
ALTER TABLE "fantasy_gameweeks" ADD COLUMN "league_id" UUID;
UPDATE "fantasy_gameweeks" SET "league_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "fantasy_gameweeks" ALTER COLUMN "league_id" SET NOT NULL;
ALTER TABLE "fantasy_gameweeks" DROP COLUMN IF EXISTS "season";

-- AlterTable fantasy_player_meta: add league_id, remove old unique
ALTER TABLE "fantasy_player_meta" DROP CONSTRAINT IF EXISTS "fantasy_player_meta_player_id_key";
ALTER TABLE "fantasy_player_meta" ADD COLUMN "league_id" UUID;
UPDATE "fantasy_player_meta" SET "league_id" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "fantasy_player_meta" ALTER COLUMN "league_id" SET NOT NULL;

-- AlterTable fantasy_audit_log: add league_id (nullable)
ALTER TABLE "fantasy_audit_log" ADD COLUMN "league_id" UUID;

-- Drop old unique constraints before adding new ones
ALTER TABLE "fantasy_teams" DROP CONSTRAINT IF EXISTS "fantasy_teams_fantasy_user_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "fantasy_teams_fantasy_user_id_league_id_key" ON "fantasy_teams"("fantasy_user_id", "league_id");
CREATE UNIQUE INDEX "fantasy_gameweeks_league_id_gameweek_number_key" ON "fantasy_gameweeks"("league_id", "gameweek_number");
CREATE UNIQUE INDEX "fantasy_player_meta_player_id_league_id_key" ON "fantasy_player_meta"("player_id", "league_id");

-- AddForeignKey
ALTER TABLE "fantasy_teams" ADD CONSTRAINT "fantasy_teams_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "fantasy_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fantasy_gameweeks" ADD CONSTRAINT "fantasy_gameweeks_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "fantasy_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fantasy_player_meta" ADD CONSTRAINT "fantasy_player_meta_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "fantasy_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fantasy_audit_log" ADD CONSTRAINT "fantasy_audit_log_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "fantasy_leagues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
