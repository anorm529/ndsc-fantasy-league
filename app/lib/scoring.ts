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

type PlayerInfo = {
  id: string;
  gender: string | null;
  squad_status: string | null;
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

export function getWeekStart(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysBack);
  monday.setHours(0, 0, 0, 0);
  return monday;
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

  const gameRes = await pool.query<{ id: string; result: string | null }>(
    "SELECT id::text, result FROM games WHERE id = $1",
    [gameId]
  );
  const game = gameRes.rows[0];
  if (!game) throw new Error("Game not found");

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

  const pg = await db.fantasyProcessedGame.upsert({
    where: { leagueId_gameId: { leagueId, gameId } },
    create: { leagueId, gameId, scoreCount: 0, priceChanges: 0 },
    update: { processedAt: new Date() },
  });

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

  const priceChanges = await calculatePriceMovements(pg.id, leagueId, scores);
  await applyPriceMovements(pg.id, leagueId, priceChanges);
  await updateFantasyTeamPoints(leagueId);

  await db.fantasyProcessedGame.update({
    where: { id: pg.id },
    data: { scoreCount: scores.length, priceChanges: priceChanges.length },
  });

  try {
    const prevGame = await db.fantasyProcessedGame.findFirst({
      where: { leagueId, processedAt: { lt: pg.processedAt }, id: { not: pg.id } },
      orderBy: { processedAt: "desc" },
    });
    await Promise.all([
      snapshotOwnership(pg.id, leagueId),
      snapshotTransferTrends(pg.id, leagueId, pg.processedAt, prevGame?.processedAt ?? null),
    ]);
  } catch {
    // Analytics failures are non-fatal
  }

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
      delta = 0.5;
      reason = "First game bonus";
    } else if (actual >= expected * 2.0) {
      delta = 2.0;
      reason = `Exceptional: ${actual} pts vs avg ${Math.round(expected)}`;
    } else if (actual >= expected * 1.5) {
      delta = 1.0;
      reason = `Big rise: ${actual} pts vs avg ${Math.round(expected)}`;
    } else if (actual >= expected * 1.25) {
      delta = 0.5;
      reason = `Rise: ${actual} pts vs avg ${Math.round(expected)}`;
    } else if (actual <= expected * 0.5) {
      delta = -2.0;
      reason = `Big fall: ${actual} pts vs avg ${Math.round(expected)}`;
    } else if (actual <= expected * 0.75) {
      delta = -1.0;
      reason = `Fall: ${actual} pts vs avg ${Math.round(expected)}`;
    }

    if (delta !== 0) {
      const rawNew = parseFloat((oldPrice + delta).toFixed(1));
      const newPrice = Math.min(20.0, Math.max(0.5, rawNew));
      changes.push({ playerId: score.playerId, oldPrice, newPrice, changeAmount: parseFloat((newPrice - oldPrice).toFixed(1)), reason });
    }
  }

  return changes;
}

async function applyPriceMovements(
  processedGameId: string,
  leagueId: string,
  changes: PriceChange[]
): Promise<void> {
  if (changes.length === 0) return;

  const teams = await db.fantasyTeam.findMany({ where: { leagueId }, select: { id: true } });
  const teamIds = teams.map((t) => t.id);

  for (const c of changes) {
    await db.fantasyPlayerMeta.update({
      where: { playerId_leagueId: { playerId: c.playerId, leagueId } },
      data: { currentPrice: c.newPrice },
    });
    if (teamIds.length > 0) {
      await db.fantasyRoster.updateMany({
        where: { playerId: c.playerId, fantasyTeamId: { in: teamIds } },
        data: { currentPrice: c.newPrice },
      });
    }
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

// --- Ownership snapshot ---

async function snapshotOwnership(processedGameId: string, leagueId: string): Promise<void> {
  const teams = await db.fantasyTeam.findMany({ where: { leagueId }, select: { id: true } });
  const totalTeams = teams.length;
  if (totalTeams === 0) return;

  const teamIds = teams.map((t) => t.id);
  const ownership = await db.fantasyRoster.groupBy({
    by: ["playerId"],
    where: { fantasyTeamId: { in: teamIds } },
    _count: { playerId: true },
  });

  for (const o of ownership) {
    const pct = parseFloat(((o._count.playerId / totalTeams) * 100).toFixed(2));
    await db.fantasyOwnershipHistory.upsert({
      where: { playerId_leagueId_processedGameId: { playerId: o.playerId, leagueId, processedGameId } },
      create: { playerId: o.playerId, leagueId, processedGameId, ownershipPercentage: pct, managerCount: o._count.playerId },
      update: { ownershipPercentage: pct, managerCount: o._count.playerId },
    });
  }
}

// --- Transfer trends snapshot ---

async function snapshotTransferTrends(
  processedGameId: string,
  leagueId: string,
  currentProcessedAt: Date,
  prevProcessedAt: Date | null
): Promise<void> {
  const teams = await db.fantasyTeam.findMany({ where: { leagueId }, select: { id: true } });
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length === 0) return;

  const dateFilter = prevProcessedAt
    ? { gt: prevProcessedAt, lte: currentProcessedAt }
    : { lte: currentProcessedAt };

  const [inGroups, outGroups] = await Promise.all([
    db.fantasyTransfer.groupBy({
      by: ["playerInId"],
      where: { fantasyTeamId: { in: teamIds }, transferDate: dateFilter },
      _count: { playerInId: true },
    }),
    db.fantasyTransfer.groupBy({
      by: ["playerOutId"],
      where: { fantasyTeamId: { in: teamIds }, transferDate: dateFilter },
      _count: { playerOutId: true },
    }),
  ]);

  const inMap = new Map(inGroups.map((g) => [g.playerInId, g._count.playerInId]));
  const outMap = new Map(outGroups.map((g) => [g.playerOutId, g._count.playerOutId]));
  const allPlayerIds = new Set([...inMap.keys(), ...outMap.keys()]);

  for (const playerId of allPlayerIds) {
    const tIn = inMap.get(playerId) ?? 0;
    const tOut = outMap.get(playerId) ?? 0;
    await db.fantasyTransferTrends.upsert({
      where: { playerId_leagueId_processedGameId: { playerId, leagueId, processedGameId } },
      create: { playerId, leagueId, processedGameId, transfersIn: tIn, transfersOut: tOut, netTransfers: tIn - tOut },
      update: { transfersIn: tIn, transfersOut: tOut, netTransfers: tIn - tOut },
    });
  }
}

// --- Team points ---
//
// Scoring rules:
//  - Captain: 2× points
//  - Rookie/development player: 2× points (stacks with captain → 4×)
//  - Women majority bonus: if >50% of squad is female, +3 pts per game processed
//  - Extra transfers: −15 pts each (1 free per Mon–Sun week)

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

  const allScores = processedGameIds.length > 0
    ? await db.fantasyScore.findMany({
        where: { processedGameId: { in: processedGameIds } },
        select: { playerId: true, fantasyPoints: true },
      })
    : [];

  const playerTotals = new Map<string, number>();
  for (const s of allScores) {
    playerTotals.set(s.playerId, (playerTotals.get(s.playerId) ?? 0) + s.fantasyPoints);
  }

  // Weekly transfer penalty: 1 free per Mon–Sun week, extras cost 15 pts each
  const weekStart = getWeekStart();
  const teamIds = teams.map((t) => t.id);
  const weeklyTransferGroups = teamIds.length > 0
    ? await db.fantasyTransfer.groupBy({
        by: ["fantasyTeamId"],
        where: { fantasyTeamId: { in: teamIds }, transferDate: { gte: weekStart } },
        _count: { fantasyTeamId: true },
      })
    : [];
  const weeklyCountMap = new Map(
    weeklyTransferGroups.map((g) => [g.fantasyTeamId, g._count.fantasyTeamId])
  );

  // Fetch player gender + squad_status from main DB for all rostered players
  const pool = getMainDb();
  const allPlayerIds = [...new Set(teams.flatMap((t) => t.roster.map((r) => r.playerId)))];
  let playerInfoList: PlayerInfo[] = [];
  if (allPlayerIds.length > 0) {
    try {
      const res = await pool.query<PlayerInfo>(`
        SELECT p.id::text, p.gender, pts.squad_status
        FROM players p
        LEFT JOIN player_team_seasons pts
          ON pts.player_id = p.id
          AND pts.season_id = (SELECT id FROM seasons WHERE is_active = true LIMIT 1)
        WHERE p.id = ANY($1::uuid[])
      `, [allPlayerIds]);
      playerInfoList = res.rows;
    } catch {
      // Non-fatal — rookie bonus and women bonus won't apply
    }
  }

  const playerGenderMap = new Map(playerInfoList.map((p) => [p.id, p.gender]));
  const playerStatusMap = new Map(playerInfoList.map((p) => [p.id, p.squad_status]));

  for (const team of teams) {
    const captainId = team.roster.find((r) => r.isCaptain)?.playerId;

    const femaleCount = team.roster.filter(
      (r) => playerGenderMap.get(r.playerId) === "female"
    ).length;
    const hasFemaleBonus = team.roster.length > 0 && femaleCount > team.roster.length / 2;

    let total = 0;
    for (const r of team.roster) {
      const rawPts = playerTotals.get(r.playerId) ?? 0;
      const isRookie = ["rookie", "development"].includes(playerStatusMap.get(r.playerId) ?? "");
      const isCaptain = r.playerId === captainId;

      let pts = rawPts;
      if (isRookie) pts *= 2;
      if (isCaptain) pts *= 2;
      total += pts;
    }

    // Women majority bonus: +3 pts per game if >50% of squad is female
    if (hasFemaleBonus) {
      total += processedGameIds.length * 3;
    }

    // Extra transfer penalty
    const weeklyCount = weeklyCountMap.get(team.id) ?? 0;
    const penalty = Math.max(0, weeklyCount - 1) * 15;
    total = Math.max(0, total - penalty);

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
