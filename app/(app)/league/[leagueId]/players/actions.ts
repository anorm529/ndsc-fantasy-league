"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/app/lib/fantasy-db";
import { requireSession } from "@/app/lib/auth";
import { getMainDb } from "@/app/lib/main-db";

export type SignPlayerResult = { error?: string };

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
  if (team.roster.length >= 5) return { error: "Squad is full (max 5 players)" };
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
