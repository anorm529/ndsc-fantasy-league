import { cacheTag, cacheLife } from "next/cache";
import { getMainDb } from "./main-db";
import { db } from "./fantasy-db";

type PlayerRow = {
  id: string;
  display_name: string;
  gender: string | null;
  squad_status: string | null;
  team_name: string | null;
};

// Player list + team names: same for all users, revalidated when admin changes player data.
export async function getPlayerListForSeason(seasonId: string) {
  "use cache";
  cacheTag("player-list");
  cacheLife("minutes");

  const pool = getMainDb();
  const [playerRes, teamsRes] = await Promise.all([
    pool.query<PlayerRow>(
      `SELECT DISTINCT ON (p.id)
         p.id, p.display_name, p.gender,
         pts.squad_status,
         t.name as team_name
       FROM player_season_stats pss
       JOIN players p ON p.id = pss.player_id
       LEFT JOIN player_team_seasons pts
         ON pts.player_id = p.id AND pts.season_id = pss.season_id
       LEFT JOIN teams t ON t.id = pts.team_id
       WHERE pss.season_id = $1
         AND p.active = true
       ORDER BY p.id`,
      [seasonId]
    ),
    pool.query<{ name: string }>(
      `SELECT DISTINCT t.name
       FROM player_team_seasons pts
       JOIN teams t ON t.id = pts.team_id
       WHERE pts.season_id = $1
       ORDER BY t.name`,
      [seasonId]
    ),
  ]);

  return {
    players: playerRes.rows,
    teamNames: teamsRes.rows.map((t) => t.name),
  };
}

// Player metas (prices + ratings): same for all users, revalidated after game pushes or
// manual price overrides via updateTag('player-metas') in admin actions.
export async function getPlayerMetasForLeague(leagueId: string) {
  "use cache";
  cacheTag("player-metas");
  cacheLife("minutes");

  return db.fantasyPlayerMeta.findMany({ where: { leagueId } });
}

// League-wide team count: used for ownership % calculation. Revalidated when managers join.
export async function getLeagueTeamCount(leagueId: string) {
  "use cache";
  cacheTag("league-team-count");
  cacheLife("minutes");

  return db.fantasyTeam.count({ where: { leagueId } });
}

// Ownership per player: revalidated when managers sign or transfer players.
export async function getOwnershipForLeague(leagueId: string, playerIds: string[]) {
  "use cache";
  cacheTag("ownership");
  cacheLife("minutes");

  if (playerIds.length === 0) return [];
  return db.fantasyRoster.groupBy({
    by: ["playerId"],
    _count: { playerId: true },
    where: { playerId: { in: playerIds }, team: { leagueId } },
  });
}
