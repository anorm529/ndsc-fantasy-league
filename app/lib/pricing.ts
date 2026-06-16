import { getMainDb } from "./main-db";
import { db } from "./fantasy-db";

type PlayerStatRow = {
  player_id: string;
  display_name: string;
  gender: string | null;
  squad_status: string | null;
  games_played: number;
  ops: number;
  obp: number;
  avg: number;
  walk_rate: number;
  unassisted_outs: number;
  assisted_outs: number;
};

type AwardRow = {
  player_id: string;
  award: string;
  season_id: string;
};

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function priceFromRating(fr: number): number {
  if (fr >= 90) return 12.0;
  if (fr >= 80) return 10.0;
  if (fr >= 70) return 8.0;
  if (fr >= 60) return 6.0;
  if (fr >= 50) return 5.0;
  if (fr >= 40) return 4.0;
  return 3.0;
}

export type PricingResult = {
  playerId: string;
  displayName: string;
  fantasyRating: number;
  price: number;
  breakdown: {
    hitting: number;
    defence: number;
    availability: number;
    experience: number;
    bonuses: number;
  };
};

// Reads end-of-season aggregate stats from player_season_stats.
// Column names: ops, obp, avg (pre-computed), uaos/aos (outs), walks.
async function computePricing(
  seasonId: string,
  regressToMean: boolean
): Promise<PricingResult[]> {
  const pool = getMainDb();

  const statsRes = await pool.query<PlayerStatRow>(`
    SELECT
      pss.player_id::text,
      p.display_name,
      p.gender,
      pts.squad_status,
      COALESCE(pss.games_played, 0)                                       AS games_played,
      COALESCE(pss.ops,  0)::float                                         AS ops,
      COALESCE(pss.obp,  0)::float                                         AS obp,
      COALESCE(pss.avg,  0)::float                                         AS avg,
      COALESCE(pss.walks::float / NULLIF(pss.games_played, 0), 0)::float  AS walk_rate,
      COALESCE(pss.uaos, 0)::int                                           AS unassisted_outs,
      COALESCE(pss.aos,  0)::int                                           AS assisted_outs
    FROM player_season_stats_archive pss
    JOIN players p ON p.id = pss.player_id
    LEFT JOIN player_team_seasons pts
      ON pts.player_id = pss.player_id
      AND pts.season_id = pss.season_id
    WHERE pss.season_id = $1
      AND p.active = true
  `, [seasonId]);

  const players = statsRes.rows;
  if (players.length === 0) return [];

  let awards: AwardRow[] = [];
  try {
    const awardsRes = await pool.query<AwardRow>(
      "SELECT player_id::text, award, season_id::text FROM awards"
    );
    awards = awardsRes.rows;
  } catch {
    // awards table may not exist; bonuses simply won't apply
  }

  const goldenGloveIds = new Set(
    awards
      .filter((a) => a.award === "Golden Glove" && a.season_id === seasonId)
      .map((a) => a.player_id)
  );

  const notableAwards = new Set(["Male MVP", "Female MVP", "Golden Glove", "Rookie"]);
  const previousAwardIds = new Set(
    awards.filter((a) => notableAwards.has(a.award)).map((a) => a.player_id)
  );

  const maxGames = Math.max(...players.map((p) => p.games_played), 1);

  // Hitting: blend of OPS, OBP, AVG (pre-computed in archive) + walk rate
  const hittingRaws = players.map(
    (p) => p.ops * 0.4 + p.obp * 0.3 + p.avg * 0.2 + p.walk_rate * 0.1
  );
  const minHitting = Math.min(...hittingRaws);
  const maxHitting = Math.max(...hittingRaws);

  // Defence: season outs total + golden glove bonus
  const defenceRaws = players.map((p) => {
    const outs = p.unassisted_outs + p.assisted_outs;
    const ggBonus = goldenGloveIds.has(p.player_id) ? 50 : 0;
    return outs + ggBonus;
  });
  const minDefence = Math.min(...defenceRaws);
  const maxDefence = Math.max(...defenceRaws);

  const MEAN_FR = 50;

  return players.map((p, i) => {
    const isRookie = p.squad_status === "rookie" || p.squad_status === "development";

    const hittingScore     = normalize(hittingRaws[i], minHitting, maxHitting);
    const defenceScore     = normalize(defenceRaws[i], minDefence, maxDefence);
    const availabilityScore = (p.games_played / maxGames) * 100;
    const experienceScore  = isRookie ? 0 : 50;

    const frBase =
      hittingScore      * 0.50 +
      defenceScore      * 0.20 +
      availabilityScore * 0.15 +
      experienceScore   * 0.15;

    let bonuses = 0;
    if (!isRookie) bonuses += 5;
    if (previousAwardIds.has(p.player_id)) bonuses += 5;

    let fr = Math.min(100, Math.round(frBase + bonuses));

    if (regressToMean) {
      fr = Math.round(fr + (MEAN_FR - fr) * 0.25);
    }

    return {
      playerId: p.player_id,
      displayName: p.display_name,
      fantasyRating: fr,
      price: priceFromRating(fr),
      breakdown: {
        hitting:      Math.round(hittingScore),
        defence:      Math.round(defenceScore),
        availability: Math.round(availabilityScore),
        experience:   Math.round(experienceScore),
        bonuses,
      },
    };
  });
}

// Active-season player list for filling gaps with FR-40 default.
// Uses player_season_stats (live table) for the current season's roster.
async function fetchSeasonPlayerList(
  seasonId: string
): Promise<{ player_id: string; display_name: string }[]> {
  const pool = getMainDb();
  const res = await pool.query<{ player_id: string; display_name: string }>(
    `SELECT DISTINCT ON (p.id) p.id::text AS player_id, p.display_name
     FROM player_season_stats pss
     JOIN players p ON p.id = pss.player_id
     WHERE pss.season_id = $1 AND p.active = true
     ORDER BY p.id`,
    [seasonId]
  );
  return res.rows;
}

/** Add FR-40 entries for any active player not yet in results. */
async function fillMissingPlayers(
  results: PricingResult[],
  activeSeasonId: string
): Promise<void> {
  let allPlayers: { player_id: string; display_name: string }[] = [];
  try {
    allPlayers = await fetchSeasonPlayerList(activeSeasonId);
  } catch {
    // If live-season table has no data yet, skip gap-fill
    return;
  }
  const pricedIds = new Set(results.map((r) => r.playerId));
  for (const row of allPlayers) {
    if (!pricedIds.has(row.player_id)) {
      results.push({
        playerId: row.player_id,
        displayName: row.display_name,
        fantasyRating: 40,
        price: priceFromRating(40),
        breakdown: { hitting: 0, defence: 0, availability: 0, experience: 0, bonuses: 0 },
      });
    }
  }
}

/** In-season pricing: reads the active season's stats from the archive. */
export async function calculateAllPrices(): Promise<PricingResult[]> {
  const pool = getMainDb();
  const seasonRes = await pool.query<{ id: string }>(
    "SELECT id FROM seasons WHERE is_active = true LIMIT 1"
  );
  const seasonId = seasonRes.rows[0]?.id;
  if (!seasonId) throw new Error("No active season found.");

  const results = await computePricing(seasonId, false);
  await fillMissingPlayers(results, seasonId);
  return results;
}

/**
 * EOS pricing: reads last season's archived stats (player_season_stats)
 * and applies 25% regression to mean. Players active this season but
 * absent from last season's archive default to FR 40.
 */
export async function calculateEOSPrices(prevSeasonId: string): Promise<PricingResult[]> {
  const pool = getMainDb();
  const results = await computePricing(prevSeasonId, true);

  const activeSeasonRes = await pool.query<{ id: string }>(
    "SELECT id FROM seasons WHERE is_active = true LIMIT 1"
  );
  const activeSeasonId = activeSeasonRes.rows[0]?.id;
  if (activeSeasonId) {
    await fillMissingPlayers(results, activeSeasonId);
  }

  return results;
}

export async function applyPrices(
  results: PricingResult[],
  adminUserId: string,
  leagueId: string
): Promise<void> {
  for (const r of results) {
    await db.fantasyPlayerMeta.upsert({
      where: { playerId_leagueId: { playerId: r.playerId, leagueId } },
      create: {
        playerId: r.playerId,
        leagueId,
        fantasyRating: r.fantasyRating,
        currentPrice: r.price,
        status: "active",
      },
      update: {
        fantasyRating: r.fantasyRating,
        currentPrice: r.price,
      },
    });
  }

  await db.fantasyAuditLog.create({
    data: {
      adminUserId,
      leagueId,
      action: "bulk_recalculate_prices",
      targetType: "all_players",
      details: `Recalculated prices for ${results.length} players`,
    },
  });
}
