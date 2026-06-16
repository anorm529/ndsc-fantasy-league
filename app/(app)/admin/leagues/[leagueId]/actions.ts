"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/app/lib/fantasy-db";
import { requireSession } from "@/app/lib/auth";
import { getMainDb } from "@/app/lib/main-db";
import { redirect } from "next/navigation";
import { calculateAllPrices, calculateEOSPrices, applyPrices } from "@/app/lib/pricing";
import { processGame, updateFantasyTeamPoints } from "@/app/lib/scoring";
import { generateAwards } from "@/app/lib/awards";

async function assertAdmin(memberUserId: string) {
  const pool = getMainDb();
  const res = await pool.query<{ role: string }>(
    "SELECT role FROM users WHERE id = $1",
    [memberUserId]
  );
  const role = res.rows[0]?.role;
  if (role !== "owner" && role !== "admin") redirect("/home");
}

async function auditLog(
  adminUserId: string,
  leagueId: string,
  action: string,
  targetType: string,
  targetId?: string,
  details?: string
) {
  await db.fantasyAuditLog.create({
    data: { adminUserId, leagueId, action, targetType, targetId, details },
  });
}

export async function updateLeagueStatusAction(leagueId: string, status: string) {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  await db.fantasyLeague.update({ where: { id: leagueId }, data: { status } });
  await auditLog(session.memberUserId, leagueId, "update_league_status", "league", leagueId, `Status → ${status}`);
  revalidatePath(`/admin/leagues/${leagueId}`);
  revalidatePath("/admin");
  revalidatePath("/home");
}

export async function toggleTransferWindowAction(leagueId: string, open: boolean) {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  await db.fantasyLeague.update({ where: { id: leagueId }, data: { transferWindowOpen: open } });
  await auditLog(session.memberUserId, leagueId, "toggle_transfer_window", "league", leagueId, open ? "Transfer window OPENED" : "Transfer window CLOSED");
  revalidatePath(`/admin/leagues/${leagueId}`);
  revalidatePath(`/league/${leagueId}/players`);
}

export async function toggleDoublePointsAction(leagueId: string, active: boolean) {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  await db.fantasyLeague.update({ where: { id: leagueId }, data: { doublePointsActive: active } });
  await auditLog(session.memberUserId, leagueId, "toggle_double_points", "league", leagueId, active ? "Double points ENABLED" : "Double points DISABLED");
  revalidatePath(`/admin/leagues/${leagueId}`);
  revalidatePath(`/league/${leagueId}/dashboard`);
}

export async function updateLeagueSettingsAction(leagueId: string, formData: FormData) {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  const squadSize = parseInt(formData.get("squad_size")?.toString() ?? "7");
  const startingBudget = parseFloat(formData.get("starting_budget")?.toString() ?? "50");
  const maxPlayersPerTeam = parseInt(formData.get("max_players_per_team")?.toString() ?? "3");
  const windowClosesAtRaw = formData.get("window_closes_at")?.toString();
  const windowClosesAt = windowClosesAtRaw ? new Date(windowClosesAtRaw) : null;

  if (isNaN(squadSize) || isNaN(startingBudget) || isNaN(maxPlayersPerTeam)) return;

  await db.fantasyLeague.update({
    where: { id: leagueId },
    data: { squadSize, startingBudget, maxPlayersPerTeam, windowClosesAt },
  });

  await auditLog(session.memberUserId, leagueId, "update_league_settings", "league", leagueId,
    `Squad: ${squadSize}, Budget: £${startingBudget}M, Max/team: ${maxPlayersPerTeam}, Window closes: ${windowClosesAt?.toISOString() ?? "none"}`
  );

  revalidatePath(`/admin/leagues/${leagueId}`);
  revalidatePath(`/league/${leagueId}/players`);
}

export async function generatePricesAction(
  leagueId: string
): Promise<{ error?: string; count?: number }> {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  try {
    const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
    if (!league) return { error: "League not found" };

    const results = league.prevSeasonId
      ? await calculateEOSPrices(league.prevSeasonId)
      : await calculateAllPrices();

    await applyPrices(results, session.memberUserId, leagueId);

    revalidateTag("player-metas", "max");
    revalidateTag("player-list", "max");
    revalidatePath(`/admin/leagues/${leagueId}`);
    revalidatePath(`/league/${leagueId}/players`);

    return { count: results.length };
  } catch (e) {
    console.error("[generatePricesAction]", e);
    return { error: e instanceof Error ? e.message : "Failed to generate prices" };
  }
}

export async function pushGameAction(
  gameId: string,
  leagueId: string
): Promise<{ error?: string; scoreCount?: number; priceChanges?: number }> {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  const result = await processGame(gameId, leagueId);

  await auditLog(
    session.memberUserId, leagueId,
    "push_game", "game", gameId,
    `${result.scoreCount} scores, ${result.priceChanges} price changes`
  );

  revalidateTag("player-metas", "max");
  revalidatePath(`/admin/leagues/${leagueId}`);
  revalidatePath(`/league/${leagueId}/dashboard`);
  revalidatePath(`/league/${leagueId}/standings`);
  revalidatePath(`/league/${leagueId}/players`);

  return { scoreCount: result.scoreCount, priceChanges: result.priceChanges };
}

export async function setPlayerPriceAction(leagueId: string, formData: FormData) {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  const playerId = formData.get("player_id")?.toString();
  const price = parseFloat(formData.get("price")?.toString() ?? "0");
  const rating = parseInt(formData.get("rating")?.toString() ?? "50");

  if (!playerId || isNaN(price)) return;

  await db.fantasyPlayerMeta.upsert({
    where: { playerId_leagueId: { playerId, leagueId } },
    create: { playerId, leagueId, currentPrice: price, fantasyRating: rating },
    update: { currentPrice: price, fantasyRating: rating },
  });

  await auditLog(session.memberUserId, leagueId, "set_player_price", "player", playerId, `Price: £${price}M, Rating: ${rating}`);
  revalidateTag("player-metas", "max");
  revalidatePath(`/admin/leagues/${leagueId}`);
  revalidatePath(`/league/${leagueId}/players`);
}

export async function setPlayerStatusAction(leagueId: string, formData: FormData) {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  const playerId = formData.get("player_id")?.toString();
  const status = formData.get("status")?.toString() ?? "active";

  if (!playerId) return;

  await db.fantasyPlayerMeta.upsert({
    where: { playerId_leagueId: { playerId, leagueId } },
    create: { playerId, leagueId, status },
    update: { status },
  });

  await auditLog(session.memberUserId, leagueId, "set_player_status", "player", playerId, `Status: ${status}`);
  revalidateTag("player-metas", "max");
  revalidatePath(`/admin/leagues/${leagueId}`);
  revalidatePath(`/league/${leagueId}/players`);
}

export async function archiveAndCloseLeagueAction(
  leagueId: string
): Promise<{ error?: string; deleted?: Record<string, number> }> {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  const pool = getMainDb();

  const teams = await db.fantasyTeam.findMany({
    where: { leagueId },
    orderBy: { totalPoints: "desc" },
    include: { user: true },
  });

  const memberIds = teams.map((t) => t.user.memberUserId);
  let memberNames: { id: string; display_name: string }[] = [];
  if (memberIds.length > 0) {
    const res = await pool.query<{ id: string; display_name: string }>(
      `SELECT u.id, COALESCE(p.display_name, u.email) as display_name
       FROM users u LEFT JOIN players p ON p.id = u.player_id
       WHERE u.id = ANY($1::uuid[])`,
      [memberIds]
    );
    memberNames = res.rows;
  }

  const processedGames = await db.fantasyProcessedGame.findMany({
    where: { leagueId },
    select: { id: true },
  });
  const processedGameIds = processedGames.map((g) => g.id);

  const topScorers = processedGameIds.length > 0
    ? await db.fantasyScore.groupBy({
        by: ["playerId"],
        where: { processedGameId: { in: processedGameIds } },
        _sum: { fantasyPoints: true },
        orderBy: { _sum: { fantasyPoints: "desc" } },
        take: 5,
      })
    : [];

  const topScorerIds = topScorers.map((s) => s.playerId);
  let topScorerNames: { id: string; display_name: string }[] = [];
  if (topScorerIds.length > 0) {
    const pRes = await pool.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])",
      [topScorerIds]
    );
    topScorerNames = pRes.rows;
  }

  const snapshot = {
    archivedAt: new Date().toISOString(),
    totalManagers: teams.length,
    gamesProcessed: processedGames.length,
    finalStandings: teams.map((t, i) => ({
      rank: i + 1,
      managerName: memberNames.find((m) => m.id === t.user.memberUserId)?.display_name ?? "Unknown",
      teamName: t.user.teamName,
      totalPoints: t.totalPoints,
    })),
    topScorers: topScorers.map((s) => ({
      playerName: topScorerNames.find((p) => p.id === s.playerId)?.display_name ?? "Unknown",
      totalPoints: s._sum.fantasyPoints ?? 0,
    })),
  };

  // Generate awards before data is deleted (awards persist after archive)
  try {
    await generateAwards(leagueId);
  } catch {
    // Non-fatal — awards can be regenerated manually
  }

  await db.fantasyAuditLog.create({
    data: {
      adminUserId: session.memberUserId,
      leagueId,
      action: "season_archived",
      targetType: "league",
      targetId: leagueId,
      details: JSON.stringify(snapshot),
    },
  });

  // Deleting processedGames cascades to scores and priceHistory
  const processedGamesDeleted = await db.fantasyProcessedGame.deleteMany({ where: { leagueId } });
  const playerMetaDeleted = await db.fantasyPlayerMeta.deleteMany({ where: { leagueId } });

  const teamIds = teams.map((t) => t.id);
  const rostersDeleted = teamIds.length > 0
    ? await db.fantasyRoster.deleteMany({ where: { fantasyTeamId: { in: teamIds } } })
    : { count: 0 };
  const transfersDeleted = teamIds.length > 0
    ? await db.fantasyTransfer.deleteMany({ where: { fantasyTeamId: { in: teamIds } } })
    : { count: 0 };

  await db.fantasyLeague.update({
    where: { id: leagueId },
    data: { status: "closed" },
  });

  revalidatePath(`/admin/leagues/${leagueId}`);
  revalidatePath("/admin");
  revalidatePath("/home");

  return {
    deleted: {
      processedGames: processedGamesDeleted.count,
      playerMeta: playerMetaDeleted.count,
      rosters: rostersDeleted.count,
      transfers: transfersDeleted.count,
    },
  };
}

export async function generateAwardsAction(
  leagueId: string
): Promise<{ error?: string; count?: number }> {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  try {
    await generateAwards(leagueId);
    const count = await db.fantasyAward.count({ where: { leagueId } });
    await auditLog(session.memberUserId, leagueId, "generate_awards", "league", leagueId, `${count} awards generated`);
    revalidatePath(`/admin/leagues/${leagueId}`);
    revalidatePath(`/league/${leagueId}/awards`);
    return { count };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to generate awards" };
  }
}
