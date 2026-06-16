import { unstable_cache } from "next/cache";
import { getMainDb } from "./main-db";
import { db } from "./fantasy-db";

type PlayerRow = {
  id: string;
  display_name: string;
  gender: string | null;
  squad_status: string | null;
  team_name: string | null;
};

export const getPlayerListForSeason = unstable_cache(
  async (seasonId: string) => {
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
  },
  ["player-list"],
  { tags: ["player-list"], revalidate: 3600 }
);

export const getPlayerMetasForLeague = unstable_cache(
  async (leagueId: string) => {
    return db.fantasyPlayerMeta.findMany({ where: { leagueId } });
  },
  ["player-metas"],
  { tags: ["player-metas"], revalidate: 3600 }
);

export const getLeagueTeamCount = unstable_cache(
  async (leagueId: string) => {
    return db.fantasyTeam.count({ where: { leagueId } });
  },
  ["league-team-count"],
  { tags: ["league-team-count"], revalidate: 3600 }
);

export const getOwnershipForLeague = unstable_cache(
  async (leagueId: string, playerIds: string[]) => {
    if (playerIds.length === 0) return [];
    return db.fantasyRoster.groupBy({
      by: ["playerId"],
      _count: { playerId: true },
      where: { playerId: { in: playerIds }, team: { leagueId } },
    });
  },
  ["ownership"],
  { tags: ["ownership"], revalidate: 3600 }
);
