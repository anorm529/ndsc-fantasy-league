import { getMainDb } from "./main-db";
import { db } from "./fantasy-db";

type PlayerStatRow = {
  player_id: string;
  display_name: string;
  gender: string | null;
  squad_status: string | null;
  games_played: number;
  singles: number;
  doubles: number;
  triples: number;
  home_runs: number;
  rbis: number;
  runs: number;
  walks: number;
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

// Aggregate per-game stats from player_game_stats joined to games.
// Uses the same raw columns as the scoring engine so data is always present.
async function fetchSeasonStats(seasonId: string): Promise<PlayerStatRow[]> {
  const pool = getMainDb();
  const res = await pool.query<PlayerStatRow>(`
    SELECT
      pgs.player_id::text,
      p.display_name,
      p.gender,
      pts.squad_status,
      COUNT(DISTINCT pgs.game_id)::int                    AS games_played,
      COALESCE(SUM(pgs.singles),          0)::float       AS singles,
      COALESCE(SUM(pgs.doubles),          0)::float       AS doubles,
      COALESCE(SUM(pgs.triples),          0)::float       AS triples,
      COALESCE(SUM(pgs.home_runs),        0)::float       AS home_runs,
      COALESCE(SUM(pgs.rbis),             0)::float       AS rbis,
      COALESCE(SUM(pgs.runs),             0)::float       AS runs,
      COALESCE(SUM(pgs.walks),            0)::float       AS walks,
      COALESCE(SUM(pgs.unassisted_outs),  0)::float       AS unassisted_outs,
      COALESCE(SUM(pgs.assisted_outs),    0)::float       AS assisted_outs
    FROM player_game_stats pgs
    JOIN games g ON g.id = pgs.game_id
    JOIN players p ON p.id = pgs.player_id
    LEFT JOIN player_team_seasons pts
      ON pts.player_id = pgs.player_id
      AND pts.season_id = g.season_id
    WHERE g.season_id = $1
      AND p.active = true
    GROUP BY pgs.player_id, p.display_name, p.gender, pts.squad_status
  `, [seasonId]);
  return res.rows;
}

async function computePricing(
  seasonId: string,
  regressToMean: boolean
): Promise<PricingResult[]> {
  const pool = getMainDb();
  const players = await fetchSeasonStats(seasonId);
  if (players.length === 0) return [];

  const awardsRes = await pool.query<AwardRow>(
    "SELECT player_id::text, award, season_id::text FROM awards"
  );
  const awards = awardsRes.rows;

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

  // Per-game hitting rate: mirrors fantasy scoring weights
  const hittingRaws = players.map((p) => {
    const g = p.games_played || 1;
    return (
      p.singles * 1 +
      p.doubles * 2 +
      p.triples * 3 +
      p.home_runs * 5 +
      p.rbis     * 1 +
      p.runs     * 1 +
      p.walks    * 1
    ) / g;
  });
  const minHitting = Math.min(...hittingRaws);
  const maxHitting = Math.max(...hittingRaws);

  // Per-game defence rate
  const defenceRaws = players.map((p) => {
    const g = p.games_played || 1;
    const outsPerGame = (p.unassisted_outs + p.assisted_outs) / g;
    const ggBonus = goldenGloveIds.has(p.player_id) ? 10 : 0;
    return outsPerGame + ggBonus;
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

    const price = priceFromRating(fr);

    return {
      playerId: p.player_id,
      displayName: p.display_name,
      fantasyRating: fr,
      price,
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

/** In-season pricing: reads the active season's live game stats. */
export async function calculateAllPrices(): Promise<PricingResult[]> {
  const pool = getMainDb();
  const seasonRes = await pool.query<{ id: string }>(
    "SELECT id FROM seasons WHERE is_active = true LIMIT 1"
  );
  const seasonId = seasonRes.rows[0]?.id;
  if (!seasonId) throw new Error("No active season found.");
  return computePricing(seasonId, false);
}

/**
 * Season-open pricing: reads the previous season's final game stats and applies
 * 25% regression to mean so last season's stars don't start untouchably priced.
 * Players with no game data in the previous season default to FR 40.
 */
export async function calculateEOSPrices(prevSeasonId: string): Promise<PricingResult[]> {
  const results = await computePricing(prevSeasonId, true);

  // Players active this season but with no game data in prevSeason get rookie pricing
  const pool = getMainDb();
  const activeSeasonRes = await pool.query<{ id: string }>(
    "SELECT id FROM seasons WHERE is_active = true LIMIT 1"
  );
  const activeSeasonId = activeSeasonRes.rows[0]?.id;

  if (activeSeasonId) {
    const activeRes = await pool.query<{ player_id: string; display_name: string }>(
      `SELECT DISTINCT pgs.player_id::text, p.display_name
       FROM player_game_stats pgs
       JOIN games g ON g.id = pgs.game_id
       JOIN players p ON p.id = pgs.player_id
       WHERE g.season_id = $1 AND p.active = true`,
      [activeSeasonId]
    );

    const pricedIds = new Set(results.map((r) => r.playerId));
    for (const row of activeRes.rows) {
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
