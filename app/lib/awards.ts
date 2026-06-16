import { db } from "./fantasy-db";
import { getMainDb } from "./main-db";

const AWARD_DEFS = [
  { name: "Fantasy Champion",      emoji: "🏆", desc: "Highest total points" },
  { name: "Best Trader",           emoji: "📈", desc: "Highest squad value growth" },
  { name: "Best Scout",            emoji: "🔍", desc: "Most profit from current squad" },
  { name: "Captain King",          emoji: "👑", desc: "Most points from captain pick" },
  { name: "Highest Single Game",   emoji: "⚡", desc: "Best score in a single game push" },
  { name: "Biggest Price Rise",    emoji: "🚀", desc: "Largest individual player price increase" },
  { name: "Diamond Hands",         emoji: "💎", desc: "Held a player the longest" },
  { name: "Transfer Addict",       emoji: "🔄", desc: "Most transfers made" },
  { name: "Rookie Whisperer",      emoji: "⭐", desc: "Most points from first-season players" },
];

export { AWARD_DEFS };

export async function generateAwards(leagueId: string): Promise<void> {
  const pool = getMainDb();

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) throw new Error("League not found");

  const teams = await db.fantasyTeam.findMany({
    where: { leagueId },
    include: { roster: true, transfers: true, user: true },
    orderBy: { totalPoints: "desc" },
  });
  if (teams.length === 0) return;

  const processedGames = await db.fantasyProcessedGame.findMany({
    where: { leagueId },
    select: { id: true },
  });
  const processedGameIds = processedGames.map((g) => g.id);

  const playerMetas = await db.fantasyPlayerMeta.findMany({ where: { leagueId } });
  const metaMap = new Map(playerMetas.map((m) => [m.playerId, m]));

  const awards: {
    awardName: string;
    winnerTeamId?: string;
    winnerPlayerId?: string;
    value: string;
    details: string;
  }[] = [];

  // 1. Fantasy Champion — highest total points
  const champion = teams[0];
  if (champion) {
    awards.push({
      awardName: "Fantasy Champion",
      winnerTeamId: champion.id,
      value: `${champion.totalPoints} pts`,
      details: champion.user.teamName,
    });
  }

  // 2. Best Trader — highest squad value growth (currentPrice - purchasePrice)
  const traderScores = teams.map((team) => {
    const growth = team.roster.reduce((sum, r) => {
      const meta = metaMap.get(r.playerId);
      const curr = meta ? Number(meta.currentPrice) : Number(r.purchasePrice);
      return sum + (curr - Number(r.purchasePrice));
    }, 0);
    return { team, growth };
  });
  const bestTrader = traderScores.sort((a, b) => b.growth - a.growth)[0];
  if (bestTrader && bestTrader.growth > 0) {
    awards.push({
      awardName: "Best Trader",
      winnerTeamId: bestTrader.team.id,
      value: `+£${bestTrader.growth.toFixed(1)}M squad growth`,
      details: bestTrader.team.user.teamName,
    });
  }

  // 3. Best Scout — highest profit from a single player purchase (max individual profit)
  let bestScoutTeam: typeof teams[0] | null = null;
  let bestScoutProfit = 0;
  let bestScoutPlayer = "";

  const allRosterPlayerIds = [...new Set(teams.flatMap((t) => t.roster.map((r) => r.playerId)))];
  let scoutPlayerNames = new Map<string, string>();
  if (allRosterPlayerIds.length > 0) {
    const res = await pool.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])",
      [allRosterPlayerIds]
    );
    scoutPlayerNames = new Map(res.rows.map((r) => [r.id, r.display_name]));
  }

  for (const team of teams) {
    for (const r of team.roster) {
      const meta = metaMap.get(r.playerId);
      const curr = meta ? Number(meta.currentPrice) : Number(r.purchasePrice);
      const profit = curr - Number(r.purchasePrice);
      if (profit > bestScoutProfit) {
        bestScoutProfit = profit;
        bestScoutTeam = team;
        bestScoutPlayer = scoutPlayerNames.get(r.playerId) ?? "Unknown";
      }
    }
  }
  if (bestScoutTeam && bestScoutProfit > 0) {
    awards.push({
      awardName: "Best Scout",
      winnerTeamId: bestScoutTeam.id,
      value: `+£${bestScoutProfit.toFixed(1)}M on ${bestScoutPlayer}`,
      details: bestScoutTeam.user.teamName,
    });
  }

  // 4. Captain King — whose captain has the most total fantasy points
  if (processedGameIds.length > 0) {
    const captainScores = await Promise.all(
      teams.map(async (team) => {
        const captain = team.roster.find((r) => r.isCaptain);
        if (!captain) return { team, points: 0 };
        const scores = await db.fantasyScore.findMany({
          where: { playerId: captain.playerId, processedGameId: { in: processedGameIds } },
          select: { fantasyPoints: true },
        });
        return { team, points: scores.reduce((s, sc) => s + sc.fantasyPoints, 0) };
      })
    );
    const captainKing = captainScores.sort((a, b) => b.points - a.points)[0];
    if (captainKing && captainKing.points > 0) {
      const captainId = captainKing.team.roster.find((r) => r.isCaptain)?.playerId;
      const captainName = captainId ? (scoutPlayerNames.get(captainId) ?? "Unknown") : "Unknown";
      awards.push({
        awardName: "Captain King",
        winnerTeamId: captainKing.team.id,
        value: `${captainKing.points} captain pts`,
        details: `${captainKing.team.user.teamName} — captaining ${captainName}`,
      });
    }
  }

  // 5. Highest Single Game — team with highest score in one game push
  if (processedGameIds.length > 0) {
    const allScores = await db.fantasyScore.findMany({
      where: { processedGameId: { in: processedGameIds } },
      select: { playerId: true, processedGameId: true, fantasyPoints: true },
    });

    const scoresByGame = new Map<string, Map<string, number>>();
    for (const s of allScores) {
      if (!scoresByGame.has(s.processedGameId)) scoresByGame.set(s.processedGameId, new Map());
      scoresByGame.get(s.processedGameId)!.set(s.playerId, s.fantasyPoints);
    }

    let bestGame = { team: teams[0], score: 0 };
    for (const [pgId, gameScores] of scoresByGame) {
      for (const team of teams) {
        const captain = team.roster.find((r) => r.isCaptain);
        let total = 0;
        for (const r of team.roster) {
          const pts = gameScores.get(r.playerId) ?? 0;
          total += r.playerId === captain?.playerId ? pts * 2 : pts;
        }
        if (total > bestGame.score) bestGame = { team, score: total };
      }
    }
    if (bestGame.score > 0) {
      awards.push({
        awardName: "Highest Single Game",
        winnerTeamId: bestGame.team.id,
        value: `${bestGame.score} pts in one game`,
        details: bestGame.team.user.teamName,
      });
    }
  }

  // 6. Biggest Price Rise — player with largest total price increase
  if (processedGameIds.length > 0) {
    const priceHistory = await db.fantasyPriceHistory.findMany({
      where: { processedGameId: { in: processedGameIds } },
      select: { playerId: true, changeAmount: true },
    });

    const riseMap = new Map<string, number>();
    for (const ph of priceHistory) {
      riseMap.set(ph.playerId, (riseMap.get(ph.playerId) ?? 0) + Number(ph.changeAmount));
    }

    const biggestRiser = [...riseMap.entries()].sort((a, b) => b[1] - a[1])[0];
    if (biggestRiser && biggestRiser[1] > 0) {
      const playerRes = await pool.query<{ display_name: string }>(
        "SELECT display_name FROM players WHERE id = $1",
        [biggestRiser[0]]
      );
      const playerName = playerRes.rows[0]?.display_name ?? "Unknown";
      awards.push({
        awardName: "Biggest Price Rise",
        winnerPlayerId: biggestRiser[0],
        value: `+£${biggestRiser[1].toFixed(1)}M`,
        details: playerName,
      });
    }
  }

  // 7. Diamond Hands — team with the oldest continuously held player
  const oldestEntry = await db.fantasyRoster.findFirst({
    where: { team: { leagueId } },
    orderBy: { joinedAt: "asc" },
  });
  if (oldestEntry) {
    const holdDays = Math.floor(
      (Date.now() - new Date(oldestEntry.joinedAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    const playerName = scoutPlayerNames.get(oldestEntry.playerId) ?? "Unknown";
    const ownerTeam = teams.find((t) => t.id === oldestEntry.fantasyTeamId);
    awards.push({
      awardName: "Diamond Hands",
      winnerTeamId: oldestEntry.fantasyTeamId,
      value: `${holdDays} days holding ${playerName}`,
      details: ownerTeam?.user.teamName ?? "Unknown",
    });
  }

  // 8. Transfer Addict — most transfers made
  const transferCounts = teams
    .map((t) => ({ team: t, count: t.transfers.length }))
    .sort((a, b) => b.count - a.count);
  const transferAddict = transferCounts[0];
  if (transferAddict && transferAddict.count > 0) {
    awards.push({
      awardName: "Transfer Addict",
      winnerTeamId: transferAddict.team.id,
      value: `${transferAddict.count} transfers`,
      details: transferAddict.team.user.teamName,
    });
  }

  // 9. Rookie Whisperer — most points from players new to this season (not in prevSeason)
  if (league.prevSeasonId && processedGameIds.length > 0) {
    const prevRes = await pool.query<{ player_id: string }>(
      "SELECT DISTINCT player_id::text FROM player_season_stats WHERE season_id = $1",
      [league.prevSeasonId]
    );
    const prevPlayerIds = new Set(prevRes.rows.map((r) => r.player_id));

    const rookieScores = await Promise.all(
      teams.map(async (team) => {
        const rookies = team.roster.filter((r) => !prevPlayerIds.has(r.playerId));
        if (rookies.length === 0) return { team, points: 0 };
        const scores = await db.fantasyScore.findMany({
          where: { playerId: { in: rookies.map((r) => r.playerId) }, processedGameId: { in: processedGameIds } },
          select: { fantasyPoints: true },
        });
        return { team, points: scores.reduce((s, sc) => s + sc.fantasyPoints, 0) };
      })
    );
    const rookieWhisperer = rookieScores.sort((a, b) => b.points - a.points)[0];
    if (rookieWhisperer && rookieWhisperer.points > 0) {
      awards.push({
        awardName: "Rookie Whisperer",
        winnerTeamId: rookieWhisperer.team.id,
        value: `${rookieWhisperer.points} pts from new players`,
        details: rookieWhisperer.team.user.teamName,
      });
    }
  }

  // Persist — delete existing, insert new
  await db.fantasyAward.deleteMany({ where: { leagueId } });
  await db.fantasyAward.createMany({
    data: awards.map((a) => ({ leagueId, ...a })),
  });
}
