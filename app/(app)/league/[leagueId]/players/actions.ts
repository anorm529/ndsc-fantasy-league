"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/app/lib/fantasy-db";
import { requireSession } from "@/app/lib/auth";
import { getMainDb } from "@/app/lib/main-db";
import { getWeekStart } from "@/app/lib/scoring";

export type SignPlayerResult = { error?: string; warning?: string };

export async function signPlayerAction(
  teamId: string,
  playerId: string,
  price: number,
  leagueId: string
): Promise<SignPlayerResult> {
  await requireSession();

  const team = await db.fantasyTeam.findUnique({
    where: { id: teamId },
    include: { roster: true },
  });

  if (!team) return { error: "Team not found" };
  if (team.roster.length >= 7) return { error: "Squad is full (max 7 players)" };
  if (Number(team.currentBudget) < price) return { error: "Insufficient budget" };

  const already = team.roster.find((r) => r.playerId === playerId);
  if (already) return { error: "Player already in squad" };

  const pool = getMainDb();
  const teamCheckRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM player_team_seasons pts
     JOIN team_seasons ts ON ts.id = pts.season_id
     WHERE pts.player_id = $1
       AND ts.team_id IN (
         SELECT ts2.team_id FROM player_team_seasons pts2
         JOIN team_seasons ts2 ON ts2.id = pts2.season_id
         WHERE pts2.player_id = ANY($2::uuid[])
       )`,
    [playerId, team.roster.map((r) => r.playerId)]
  );

  const sameTeamCount = parseInt(teamCheckRes.rows[0]?.count ?? "0");
  if (sameTeamCount >= 2) {
    return { error: "Maximum 2 players from the same NDSC team" };
  }

  await db.$transaction([
    db.fantasyRoster.create({
      data: { fantasyTeamId: teamId, playerId, purchasePrice: price, currentPrice: price },
    }),
    db.fantasyTeam.update({
      where: { id: teamId },
      data: { currentBudget: { decrement: price } },
    }),
  ]);

  revalidatePath(`/league/${leagueId}/players`);
  revalidatePath(`/league/${leagueId}/my-team`);

  return {};
}

export async function transferPlayerAction(
  teamId: string,
  rosterOutId: string,
  playerInId: string,
  price: number,
  leagueId: string
): Promise<SignPlayerResult> {
  await requireSession();

  const team = await db.fantasyTeam.findUnique({
    where: { id: teamId },
    include: { roster: true },
  });
  if (!team) return { error: "Team not found" };

  const rosterOut = team.roster.find((r) => r.id === rosterOutId);
  if (!rosterOut) return { error: "Player not found in squad" };

  const already = team.roster.find((r) => r.playerId === playerInId);
  if (already) return { error: "Player already in squad" };

  const refund = Number(rosterOut.currentPrice);
  const newBudget = Number(team.currentBudget) + refund - price;
  if (newBudget < 0) return { error: "Insufficient budget for this transfer" };

  const remainingPlayerIds = team.roster
    .filter((r) => r.id !== rosterOutId)
    .map((r) => r.playerId);

  const pool = getMainDb();
  if (remainingPlayerIds.length > 0) {
    const teamCheckRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM player_team_seasons pts
       JOIN team_seasons ts ON ts.id = pts.season_id
       WHERE pts.player_id = $1
         AND ts.team_id IN (
           SELECT ts2.team_id FROM player_team_seasons pts2
           JOIN team_seasons ts2 ON ts2.id = pts2.season_id
           WHERE pts2.player_id = ANY($2::uuid[])
         )`,
      [playerInId, remainingPlayerIds]
    );
    const sameTeamCount = parseInt(teamCheckRes.rows[0]?.count ?? "0");
    if (sameTeamCount >= 2) {
      return { error: "Maximum 2 players from the same NDSC team" };
    }
  }

  // Count this week's transfers to determine if this is a free or paid transfer
  const weekStart = getWeekStart();
  const weeklyCount = await db.fantasyTransfer.count({
    where: { fantasyTeamId: teamId, transferDate: { gte: weekStart } },
  });
  const isExtraTransfer = weeklyCount >= 1;
  const transferCost = isExtraTransfer ? 15 : 0;

  await db.$transaction([
    db.fantasyRoster.delete({ where: { id: rosterOutId } }),
    db.fantasyRoster.create({
      data: { fantasyTeamId: teamId, playerId: playerInId, purchasePrice: price, currentPrice: price },
    }),
    db.fantasyTeam.update({
      where: { id: teamId },
      data: { currentBudget: newBudget },
    }),
    db.fantasyTransfer.create({
      data: {
        fantasyTeamId: teamId,
        playerOutId: rosterOut.playerId,
        playerInId,
        transferCost,
      },
    }),
  ]);

  revalidatePath(`/league/${leagueId}/players`);
  revalidatePath(`/league/${leagueId}/my-team`);

  return isExtraTransfer
    ? { warning: `Transfer complete. −${transferCost} pts will be deducted at the next game push.` }
    : {};
}
