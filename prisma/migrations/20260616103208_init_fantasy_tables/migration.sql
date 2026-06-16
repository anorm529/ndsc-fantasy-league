-- CreateTable
CREATE TABLE "fantasy_users" (
    "id" UUID NOT NULL,
    "member_user_id" UUID NOT NULL,
    "team_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fantasy_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fantasy_sessions" (
    "id" UUID NOT NULL,
    "fantasy_user_id" UUID NOT NULL,
    "session_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fantasy_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fantasy_teams" (
    "id" UUID NOT NULL,
    "fantasy_user_id" UUID NOT NULL,
    "season" TEXT NOT NULL,
    "current_budget" DECIMAL(10,1) NOT NULL DEFAULT 40.0,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "overall_rank" INTEGER,

    CONSTRAINT "fantasy_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fantasy_roster" (
    "id" UUID NOT NULL,
    "fantasy_team_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "purchase_price" DECIMAL(10,1) NOT NULL,
    "current_price" DECIMAL(10,1) NOT NULL,
    "is_captain" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fantasy_roster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fantasy_gameweeks" (
    "id" UUID NOT NULL,
    "season" TEXT NOT NULL,
    "gameweek_number" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fantasy_gameweeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fantasy_scores" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "gameweek_id" UUID NOT NULL,
    "fantasy_points" INTEGER NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fantasy_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fantasy_transfers" (
    "id" UUID NOT NULL,
    "fantasy_team_id" UUID NOT NULL,
    "player_out_id" UUID NOT NULL,
    "player_in_id" UUID NOT NULL,
    "transfer_cost" INTEGER NOT NULL DEFAULT 0,
    "transfer_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fantasy_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fantasy_price_history" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "gameweek_id" UUID NOT NULL,
    "old_price" DECIMAL(10,1) NOT NULL,
    "new_price" DECIMAL(10,1) NOT NULL,
    "change_amount" DECIMAL(10,1) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "fantasy_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fantasy_player_meta" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "fantasy_rating" INTEGER NOT NULL DEFAULT 50,
    "current_price" DECIMAL(10,1) NOT NULL DEFAULT 3.0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fantasy_player_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fantasy_audit_log" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fantasy_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fantasy_users_member_user_id_key" ON "fantasy_users"("member_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fantasy_sessions_session_token_key" ON "fantasy_sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "fantasy_teams_fantasy_user_id_key" ON "fantasy_teams"("fantasy_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fantasy_roster_fantasy_team_id_player_id_key" ON "fantasy_roster"("fantasy_team_id", "player_id");

-- CreateIndex
CREATE UNIQUE INDEX "fantasy_gameweeks_season_gameweek_number_key" ON "fantasy_gameweeks"("season", "gameweek_number");

-- CreateIndex
CREATE UNIQUE INDEX "fantasy_scores_player_id_gameweek_id_key" ON "fantasy_scores"("player_id", "gameweek_id");

-- CreateIndex
CREATE UNIQUE INDEX "fantasy_player_meta_player_id_key" ON "fantasy_player_meta"("player_id");

-- AddForeignKey
ALTER TABLE "fantasy_sessions" ADD CONSTRAINT "fantasy_sessions_fantasy_user_id_fkey" FOREIGN KEY ("fantasy_user_id") REFERENCES "fantasy_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fantasy_teams" ADD CONSTRAINT "fantasy_teams_fantasy_user_id_fkey" FOREIGN KEY ("fantasy_user_id") REFERENCES "fantasy_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fantasy_roster" ADD CONSTRAINT "fantasy_roster_fantasy_team_id_fkey" FOREIGN KEY ("fantasy_team_id") REFERENCES "fantasy_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fantasy_scores" ADD CONSTRAINT "fantasy_scores_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "fantasy_gameweeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fantasy_transfers" ADD CONSTRAINT "fantasy_transfers_fantasy_team_id_fkey" FOREIGN KEY ("fantasy_team_id") REFERENCES "fantasy_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
