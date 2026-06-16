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
      pss.games_played,
      COALESCE(pss.ops,      0)::float AS ops,
      COALESCE(pss.obp,      0)::float AS obp,
      COALESCE(pss.avg,      0)::float AS avg,
      COALESCE(pss.walk_rate,0)::float AS walk_rate,
      COALESCE(pss.unassisted_outs, 0) AS unassisted_outs,
      COALESCE(pss.assisted_outs,   0) AS assisted_outs
    FROM player_season_stats pss
    JOIN players p ON p.id = pss.player_id
    LEFT JOIN player_team_seasons pts
      ON pts.player_id = pss.player_id
      AND pts.season_id = pss.season_id
    WHERE pss.season_id = $1
      AND p.active = true
  `, [seasonId]);

  const players = statsRes.rows;
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

  const hittingRaws = players.map(
    (p) => p.ops * 0.4 + p.obp * 0.3 + p.avg * 0.2 + p.walk_rate * 0.1
  );
  const minHitting = Math.min(...hittingRaws);
  const maxHitting = Math.max(...hittingRaws);

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

    const hittingScore = normalize(hittingRaws[i], minHitting, maxHitting);
    const defenceScore = normalize(defenceRaws[i], minDefence, maxDefence);
    const availabilityScore = (p.games_played / maxGames) * 100;
    const experienceScore = isRookie ? 0 : 50;

    const frBase =
      hittingScore      * 0.50 +
      defenceScore      * 0.20 +
      availabilityScore * 0.15 +
      experienceScore   * 0.15;

    let bonuses = 0;
    if (!isRookie) bonuses += 5;
    if (previousAwardIds.has(p.player_id)) bonuses += 5;

    let fr = Math.min(100, Math.round(frBase + bonuses));

    // Regression to mean for season-open EOS pricing (25% pull toward 50)
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

/** In-season pricing: reads the active season's live stats. */
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
 * Season-open pricing: reads a previous season's final stats and applies
 * 25% regression to mean so last season's stars don't start untouchably priced.
 * Players not found in the previous season (true rookies) default to FR 40.
 */
export async function calculateEOSPrices(prevSeasonId: string): Promise<PricingResult[]> {
  const results = await computePricing(prevSeasonId, true);

  // Any player in the ACTIVE season who isn't in prevSeason gets rookie pricing
  const pool = getMainDb();
  const activeSeasonRes = await pool.query<{ id: string }>(
    "SELECT id FROM seasons WHERE is_active = true LIMIT 1"
  );
  const activeSeasonId = activeSeasonRes.rows[0]?.id;

  if (activeSeasonId) {
    const activeRes = await pool.query<{ player_id: string; display_name: string }>(
      `SELECT pss.player_id::text, p.display_name
       FROM player_season_stats pss
       JOIN players p ON p.id = pss.player_id
       WHERE pss.season_id = $1 AND p.active = true`,
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
