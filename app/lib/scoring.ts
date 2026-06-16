import { getMainDb } from "./main-db";
import { db } from "./fantasy-db";

type GameStatRow = {
  player_id: string;
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

function calcBattingPoints(row: GameStatRow): number {
  return (
    (row.singles       || 0) * 1 +
    (row.doubles       || 0) * 2 +
    (row.triples       || 0) * 3 +
    (row.home_runs     || 0) * 5 +
    (row.rbis          || 0) * 1 +
    (row.runs          || 0) * 1 +
    (row.walks         || 0) * 1
  );
}

function calcDefencePoints(row: GameStatRow): number {
  return (row.unassisted_outs || 0) + (row.assisted_outs || 0);
}

function calcResultPoints(result: string | null): number {
  if (result === "W") return 3;
  if (result === "D") return 1;
  return 0;
}

export type ProcessGameResult = {
  scoreCount: number;
  priceChanges: number;
};

export async function processGame(
  gameId: string,
  leagueId: string
): Promise<ProcessGameResult> {
  const pool = getMainDb();

  // Fetch game info
  const gameRes = await pool.query<{ id: string; result: string | null }>(
    "SELECT id::text, result FROM games WHERE id = $1",
    [gameId]
  );
  const game = gameRes.rows[0];
  if (!game) throw new Error("Game not found");

  // Fetch player stats for this game
  const statsRes = await pool.query<GameStatRow>(`
    SELECT
      pgs.player_id::text,
      COALESCE(pgs.singles,         0) AS singles,
      COALESCE(pgs.doubles,         0) AS doubles,
      COALESCE(pgs.triples,         0) AS triples,
      COALESCE(pgs.home_runs,       0) AS home_runs,
      COALESCE(pgs.rbis,            0) AS rbis,
      COALESCE(pgs.runs,            0) AS runs,
      COALESCE(pgs.walks,           0) AS walks,
      COALESCE(pgs.unassisted_outs, 0) AS unassisted_outs,
      COALESCE(pgs.assisted_outs,   0) AS assisted_outs
    FROM player_game_stats pgs
    WHERE pgs.game_id = $1
  `, [gameId]);

  // Upsert the processed game record (creates or updates timestamp)
  const pg = await db.fantasyProcessedGame.upsert({
    where: { leagueId_gameId: { leagueId, gameId } },
    create: { leagueId, gameId, scoreCount: 0, priceChanges: 0 },
    update: { processedAt: new Date() },
  });

  // Calculate and save scores
  const scores: { playerId: string; points: number }[] = [];

  for (const row of statsRes.rows) {
    const batting   = calcBattingPoints(row);
    const defence   = calcDefencePoints(row);
    const resultPts = calcResultPoints(game.result);
    const total = batting + defence + resultPts;

    await db.fantasyScore.upsert({
      where: { playerId_processedGameId: { playerId: row.player_id, processedGameId: pg.id } },
      create: { playerId: row.player_id, processedGameId: pg.id, fantasyPoints: total },
      update: { fantasyPoints: total, calculatedAt: new Date() },
    });

    scores.push({ playerId: row.player_id, points: total });
  }

  // Price movements based on rolling 5-game average within this league
  const priceChanges = await calculatePriceMovements(pg.id, leagueId, scores);
  await applyPriceMovements(pg.id, leagueId, priceChanges);

  // Update team totals
  await updateFantasyTeamPoints(leagueId);

  // Write final counts back to processed game record
  await db.fantasyProcessedGame.update({
    where: { id: pg.id },
    data: { scoreCount: scores.length, priceChanges: priceChanges.length },
  });

  return { scoreCount: scores.length, priceChanges: priceChanges.length };
}

// --- Price movements ---

type PriceChange = {
  playerId: string;
  oldPrice: number;
  newPrice: number;
  changeAmount: number;
  reason: string;
};

async function calculatePriceMovements(
  processedGameId: string,
  leagueId: string,
  scores: { playerId: string; points: number }[]
): Promise<PriceChange[]> {
  const changes: PriceChange[] = [];
  if (scores.length === 0) return changes;

  const pg = await db.fantasyProcessedGame.findUnique({ where: { id: processedGameId } });
  if (!pg) return changes;

  // Last 5 processed games for this league BEFORE this one (by processedAt)
  const priorGames = await db.fantasyProcessedGame.findMany({
    where: { leagueId, processedAt: { lt: pg.processedAt }, id: { not: processedGameId } },
    orderBy: { processedAt: "desc" },
    take: 5,
  });
  const priorGameIds = priorGames.map((g) => g.id);

  const playerIds = scores.map((s) => s.playerId);
  const allMeta = await db.fantasyPlayerMeta.findMany({
    where: { leagueId, playerId: { in: playerIds } },
  });
  const metaMap = new Map(allMeta.map((m) => [m.playerId, m]));

  async function getRollingAvg(playerId: string): Promise<number> {
    if (priorGameIds.length === 0) return 0;
    const prior = await db.fantasyScore.findMany({
      where: { playerId, processedGameId: { in: priorGameIds } },
      select: { fantasyPoints: true },
    });
    if (prior.length === 0) return 0;
    return prior.reduce((s, r) => s + r.fantasyPoints, 0) / prior.length;
  }

  for (const score of scores) {
    const meta = metaMap.get(score.playerId);
    if (!meta) continue;

    const oldPrice = Number(meta.currentPrice);
    const expected = await getRollingAvg(score.playerId);
    const actual = score.points;

    let delta = 0;
    let reason = "";

    if (expected === 0) {
      delta = 0.2;
      reason = "Debut/first game bonus";
    } else if (actual >= expected * 1.5) {
      delta = 0.4;
      reason = `Big rise: ${actual} pts vs avg ${Math.round(expected)}`;
    } else if (actual >= expected * 1.25) {
      delta = 0.2;
      reason = `Rise: ${actual} pts vs avg ${Math.round(expected)}`;
    } else if (actual <= expected * 0.75) {
      delta = -0.2;
      reason = `Fall: ${actual} pts vs avg ${Math.round(expected)}`;
    }

    if (delta !== 0) {
      const newPrice = Math.max(0.5, parseFloat((oldPrice + delta).toFixed(1)));
      changes.push({ playerId: score.playerId, oldPrice, newPrice, changeAmount: delta, reason });
    }
  }

  return changes;
}

async function applyPriceMovements(
  processedGameId: string,
  leagueId: string,
  changes: PriceChange[]
): Promise<void> {
  for (const c of changes) {
    await db.fantasyPlayerMeta.update({
      where: { playerId_leagueId: { playerId: c.playerId, leagueId } },
      data: { currentPrice: c.newPrice },
    });
    await db.fantasyPriceHistory.create({
      data: {
        playerId: c.playerId,
        processedGameId,
        oldPrice: c.oldPrice,
        newPrice: c.newPrice,
        changeAmount: c.changeAmount,
        reason: c.reason,
      },
    });
  }
}

export async function updateFantasyTeamPoints(leagueId: string): Promise<void> {
  const teams = await db.fantasyTeam.findMany({
    where: { leagueId },
    include: { roster: true },
  });

  const processedGames = await db.fantasyProcessedGame.findMany({
    where: { leagueId },
    select: { id: true },
  });
  const processedGameIds = processedGames.map((g) => g.id);

  for (const team of teams) {
    const captainId = team.roster.find((r) => r.isCaptain)?.playerId;
    let total = 0;

    for (const r of team.roster) {
      const playerScores = await db.fantasyScore.findMany({
        where: { playerId: r.playerId, processedGameId: { in: processedGameIds } },
        select: { fantasyPoints: true },
      });
      const pts = playerScores.reduce((s, sc) => s + sc.fantasyPoints, 0);
      total += r.playerId === captainId ? pts * 2 : pts;
    }

    await db.fantasyTeam.update({
      where: { id: team.id },
      data: { totalPoints: total },
    });
  }

  const ranked = await db.fantasyTeam.findMany({
    where: { leagueId },
    orderBy: { totalPoints: "desc" },
  });
  for (let i = 0; i < ranked.length; i++) {
    await db.fantasyTeam.update({
      where: { id: ranked[i].id },
      data: { overallRank: i + 1 },
    });
  }
}
