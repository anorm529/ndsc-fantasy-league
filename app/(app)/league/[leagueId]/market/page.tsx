import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { notFound } from "next/navigation";

export const metadata = { title: "Market — NDSC Fantasy" };

function PriceSparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <span className="text-slate-300 text-xs">—</span>;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 0.1;
  const W = 60, H = 20;
  const pts = prices
    .map((p, i) => [
      1 + (i / (prices.length - 1)) * 58,
      19 - ((p - min) / range) * 18,
    ])
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const color = prices[prices.length - 1] >= prices[0] ? "#16a34a" : "#dc2626";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function MarketPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const session = await requireSession();
  const pool = getMainDb();

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const fantasyUser = await db.fantasyUser.findUnique({ where: { memberUserId: session.memberUserId } });
  const myTeam = fantasyUser
    ? await db.fantasyTeam.findUnique({
        where: { fantasyUserId_leagueId: { fantasyUserId: fantasyUser.id, leagueId } },
        include: { roster: true },
      })
    : null;

  const playerMetas = await db.fantasyPlayerMeta.findMany({
    where: { leagueId },
    orderBy: { currentPrice: "desc" },
  });

  const teams = await db.fantasyTeam.findMany({ where: { leagueId }, select: { id: true } });
  const teamIds = teams.map((t) => t.id);
  const totalTeams = teamIds.length;

  // Ownership counts
  const ownershipData = teamIds.length > 0
    ? await db.fantasyRoster.groupBy({
        by: ["playerId"],
        where: { fantasyTeamId: { in: teamIds } },
        _count: { playerId: true },
      })
    : [];
  const ownershipMap = new Map(ownershipData.map((o) => [o.playerId, o._count.playerId]));

  // Price history for sparklines + season high/low
  const processedGames = await db.fantasyProcessedGame.findMany({
    where: { leagueId },
    select: { id: true },
    orderBy: { processedAt: "asc" },
  });
  const processedGameIds = processedGames.map((g) => g.id);

  const priceHistory = processedGameIds.length > 0
    ? await db.fantasyPriceHistory.findMany({
        where: { processedGameId: { in: processedGameIds } },
        orderBy: { processedGame: { processedAt: "asc" } },
        select: { playerId: true, oldPrice: true, newPrice: true, changeAmount: true },
      })
    : [];

  // Build sparkline data per player
  const historyByPlayer = new Map<string, number[]>();
  for (const ph of priceHistory) {
    if (!historyByPlayer.has(ph.playerId)) {
      historyByPlayer.set(ph.playerId, [Number(ph.oldPrice)]);
    }
    historyByPlayer.get(ph.playerId)!.push(Number(ph.newPrice));
  }

  // Player names
  const playerIds = playerMetas.map((m) => m.playerId);
  const playerNames = new Map<string, string>();
  if (playerIds.length > 0) {
    const res = await pool.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])",
      [playerIds]
    );
    for (const r of res.rows) playerNames.set(r.id, r.display_name);
  }

  // Build market data
  const marketData = playerMetas.map((meta) => {
    const history = historyByPlayer.get(meta.playerId) ?? [];
    const currentPrice = Number(meta.currentPrice);
    const allPrices = history.length > 0 ? history : [currentPrice];
    const sparkline = [...allPrices, currentPrice];
    const startPrice = allPrices[0];
    const seasonHigh = Math.max(...allPrices, currentPrice);
    const seasonLow = Math.min(...allPrices, currentPrice);
    const totalChange = currentPrice - startPrice;
    const pctChange = startPrice > 0 ? (totalChange / startPrice) * 100 : 0;
    const ownedBy = ownershipMap.get(meta.playerId) ?? 0;
    const ownershipPct = totalTeams > 0 ? (ownedBy / totalTeams) * 100 : 0;
    const myRosterEntry = myTeam?.roster.find((r) => r.playerId === meta.playerId);
    const purchasePrice = myRosterEntry ? Number(myRosterEntry.purchasePrice) : null;
    const profit = purchasePrice !== null ? currentPrice - purchasePrice : null;
    const profitPct = purchasePrice !== null && purchasePrice > 0
      ? (profit! / purchasePrice) * 100
      : null;

    return {
      playerId: meta.playerId,
      name: playerNames.get(meta.playerId) ?? "Unknown",
      currentPrice,
      fantasyRating: meta.fantasyRating,
      seasonHigh,
      seasonLow,
      sparkline,
      totalChange,
      pctChange,
      ownershipPct,
      ownedBy,
      purchasePrice,
      profit,
      profitPct,
      isOwned: !!myRosterEntry,
    };
  });

  // Dashboard stats
  const risers = [...marketData].filter((p) => p.totalChange > 0).sort((a, b) => b.totalChange - a.totalChange).slice(0, 5);
  const fallers = [...marketData].filter((p) => p.totalChange < 0).sort((a, b) => a.totalChange - b.totalChange).slice(0, 5);
  const mostOwned = [...marketData].sort((a, b) => b.ownershipPct - a.ownershipPct).slice(0, 5);
  const mostProfitable = [...marketData].filter((p) => p.profit !== null).sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0)).slice(0, 5);

  const hasHistory = priceHistory.length > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Player Market</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Track player value growth, ownership trends, and profit on your squad.
        </p>
      </div>

      {/* Dashboard strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniList title="Biggest Risers" color="green" items={risers.map((p) => ({
          label: p.name,
          value: `+£${p.totalChange.toFixed(1)}M`,
          sub: `${p.pctChange.toFixed(0)}%`,
        }))} empty={!hasHistory} />
        <MiniList title="Biggest Fallers" color="red" items={fallers.map((p) => ({
          label: p.name,
          value: `-£${Math.abs(p.totalChange).toFixed(1)}M`,
          sub: `${p.pctChange.toFixed(0)}%`,
        }))} empty={!hasHistory} />
        <MiniList title="Most Owned" color="navy" items={mostOwned.filter((p) => p.ownershipPct > 0).map((p) => ({
          label: p.name,
          value: `${p.ownershipPct.toFixed(0)}%`,
          sub: `${p.ownedBy} managers`,
        }))} empty={totalTeams === 0} />
        <MiniList title="My Profit/Loss" color="gold" items={mostProfitable.map((p) => ({
          label: p.name,
          value: `${(p.profit ?? 0) >= 0 ? "+" : ""}£${(p.profit ?? 0).toFixed(1)}M`,
          sub: `${(p.profitPct ?? 0) >= 0 ? "+" : ""}${(p.profitPct ?? 0).toFixed(0)}%`,
        }))} empty={!myTeam || myTeam.roster.length === 0} />
      </div>

      {/* Full player table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">All Players</h2>
          <p className="text-xs text-slate-400 mt-0.5">Price history updates each time a game is pushed. Your P&L shown if player is in your squad.</p>
        </div>
        {playerMetas.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            No players priced yet — run Price Generation from the admin panel.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <th className="text-left px-5 py-3">Player</th>
                  <th className="text-right px-3 py-3">Price</th>
                  <th className="text-center px-3 py-3 hidden sm:table-cell">Chart</th>
                  <th className="text-center px-3 py-3 hidden md:table-cell">High</th>
                  <th className="text-center px-3 py-3 hidden md:table-cell">Low</th>
                  <th className="text-right px-3 py-3">Change</th>
                  <th className="text-right px-3 py-3 hidden sm:table-cell">Owned</th>
                  <th className="text-center px-3 py-3 hidden lg:table-cell">FR</th>
                  <th className="text-right px-5 py-3">P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {marketData.map((p) => {
                  const changePositive = p.totalChange > 0;
                  const changeNeutral = p.totalChange === 0;
                  const profitPositive = (p.profit ?? 0) >= 0;
                  return (
                    <tr key={p.playerId} className={`transition-colors ${p.isOwned ? "bg-blue-50/40 hover:bg-blue-50/60" : "hover:bg-slate-50"}`}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          {p.isOwned && (
                            <span className="w-1.5 h-1.5 rounded-full bg-ndsc-navy flex-shrink-0" />
                          )}
                          <span className="font-medium text-slate-800">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-slate-900">
                        £{p.currentPrice.toFixed(1)}M
                      </td>
                      <td className="px-3 py-3 text-center hidden sm:table-cell">
                        <PriceSparkline prices={p.sparkline} />
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-slate-500 hidden md:table-cell">
                        £{p.seasonHigh.toFixed(1)}M
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-slate-500 hidden md:table-cell">
                        £{p.seasonLow.toFixed(1)}M
                      </td>
                      <td className="px-3 py-3 text-right">
                        {changeNeutral ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <span className={`text-xs font-semibold ${changePositive ? "text-green-600" : "text-red-500"}`}>
                            {changePositive ? "+" : ""}£{p.totalChange.toFixed(1)}M
                            <span className="ml-1 text-slate-400 font-normal">
                              ({changePositive ? "+" : ""}{p.pctChange.toFixed(0)}%)
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right hidden sm:table-cell">
                        <span className="text-xs text-slate-500">{p.ownershipPct.toFixed(0)}%</span>
                      </td>
                      <td className="px-3 py-3 text-center hidden lg:table-cell">
                        <span className="text-xs font-medium text-slate-500">{p.fantasyRating}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {p.profit !== null ? (
                          <div>
                            <span className={`text-xs font-bold ${profitPositive ? "text-green-600" : "text-red-500"}`}>
                              {profitPositive ? "+" : ""}£{p.profit.toFixed(1)}M
                            </span>
                            <span className="block text-xs text-slate-400">
                              {profitPositive ? "+" : ""}{p.profitPct?.toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Blue dot indicates player is in your squad. P&amp;L = current price vs your purchase price.
        Season High/Low derived from all game pushes this season.
      </p>
    </div>
  );
}

function MiniList({
  title, color, items, empty,
}: {
  title: string;
  color: "green" | "red" | "navy" | "gold";
  items: { label: string; value: string; sub?: string }[];
  empty: boolean;
}) {
  const accent = {
    green: "text-green-600",
    red: "text-red-500",
    navy: "text-ndsc-navy",
    gold: "text-ndsc-gold",
  }[color];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {empty || items.length === 0 ? (
        <p className="text-xs text-slate-300">No data yet</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between text-sm gap-2">
              <span className="text-slate-700 truncate">{item.label}</span>
              <div className="text-right flex-shrink-0">
                <span className={`font-bold text-xs ${accent}`}>{item.value}</span>
                {item.sub && <span className="ml-1 text-xs text-slate-400">{item.sub}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
