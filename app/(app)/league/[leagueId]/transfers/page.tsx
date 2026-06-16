import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { notFound } from "next/navigation";

export const dynamic = 'force-dynamic';
export const metadata = { title: "Transfers — NDSC Fantasy" };

export default async function TransfersPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  await requireSession();
  const pool = getMainDb();

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const teams = await db.fantasyTeam.findMany({
    where: { leagueId },
    include: { user: true },
  });
  const teamIds = teams.map((t) => t.id);
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  // All transfers in this league
  const allTransfers = teamIds.length > 0
    ? await db.fantasyTransfer.findMany({
        where: { fantasyTeamId: { in: teamIds } },
        orderBy: { transferDate: "desc" },
      })
    : [];

  // Compute most bought / most sold
  const buyMap = new Map<string, number>();
  const sellMap = new Map<string, number>();
  for (const t of allTransfers) {
    buyMap.set(t.playerInId, (buyMap.get(t.playerInId) ?? 0) + 1);
    sellMap.set(t.playerOutId, (sellMap.get(t.playerOutId) ?? 0) + 1);
  }
  const mostBought = [...buyMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mostSold = [...sellMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Net transfers (transfers in - transfers out) per player
  const netMap = new Map<string, number>();
  for (const [pid, count] of buyMap) netMap.set(pid, (netMap.get(pid) ?? 0) + count);
  for (const [pid, count] of sellMap) netMap.set(pid, (netMap.get(pid) ?? 0) - count);
  const risingOwnership = [...netMap.entries()]
    .filter(([, net]) => net > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Get player names
  const allPlayerIds = [...new Set([
    ...mostBought.map(([id]) => id),
    ...mostSold.map(([id]) => id),
    ...risingOwnership.map(([id]) => id),
    ...allTransfers.flatMap((t) => [t.playerInId, t.playerOutId]),
  ])];

  const playerNames = new Map<string, string>();
  if (allPlayerIds.length > 0) {
    const res = await pool.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])",
      [allPlayerIds]
    );
    for (const r of res.rows) playerNames.set(r.id, r.display_name);
  }

  // Member names for team display
  const memberIds = teams.map((t) => t.user.memberUserId);
  const memberNames = new Map<string, string>();
  if (memberIds.length > 0) {
    const res = await pool.query<{ id: string; name: string }>(
      `SELECT u.id, COALESCE(p.display_name, u.email) as name
       FROM users u LEFT JOIN players p ON p.id = u.player_id
       WHERE u.id = ANY($1::uuid[])`,
      [memberIds]
    );
    for (const r of res.rows) memberNames.set(r.id, r.name);
  }

  // Transfer trends per game push (most recent 8)
  const processedGames = await db.fantasyProcessedGame.findMany({
    where: { leagueId },
    orderBy: { processedAt: "desc" },
    take: 8,
    select: { id: true, processedAt: true, gameId: true },
  });

  const trendsByGame = processedGames.length > 0
    ? await db.fantasyTransferTrends.findMany({
        where: { leagueId, processedGameId: { in: processedGames.map((g) => g.id) } },
        orderBy: { processedGame: { processedAt: "desc" } },
      })
    : [];

  // Group trends by processedGameId
  const trendsByGameMap = new Map<string, typeof trendsByGame>();
  for (const t of trendsByGame) {
    const existing = trendsByGameMap.get(t.processedGameId) ?? [];
    existing.push(t);
    trendsByGameMap.set(t.processedGameId, existing);
  }

  // Total transfers per manager
  const transfersPerManager = teams
    .map((t) => ({
      teamName: t.user.teamName,
      managerName: memberNames.get(t.user.memberUserId) ?? "Unknown",
      count: allTransfers.filter((tr) => tr.fantasyTeamId === t.id).length,
    }))
    .sort((a, b) => b.count - a.count);

  const recentTransfers = allTransfers.slice(0, 20);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Transfer Intelligence</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Track buying and selling trends across the league. Snapshots are taken each time a game is pushed.
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Transfers" value={allTransfers.length.toString()} />
        <StatCard label="Players Bought/Sold" value={buyMap.size.toString()} />
        <StatCard label="Most Active Manager" value={transfersPerManager[0]?.teamName ?? "—"} />
        <StatCard label="Biggest Mover" value={mostBought[0] ? (playerNames.get(mostBought[0][0]) ?? "—") : "—"} />
      </div>

      {/* Most bought / most sold / rising ownership */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TransferList title="Most Bought" items={mostBought.map(([id, count]) => ({
          name: playerNames.get(id) ?? "Unknown", value: `${count}× in`, positive: true,
        }))} />
        <TransferList title="Most Sold" items={mostSold.map(([id, count]) => ({
          name: playerNames.get(id) ?? "Unknown", value: `${count}× out`, positive: false,
        }))} />
        <TransferList title="Fastest Rising Ownership" items={risingOwnership.map(([id, net]) => ({
          name: playerNames.get(id) ?? "Unknown", value: `+${net} net`, positive: true,
        }))} />
      </div>

      {/* Transfer trends per game push */}
      {processedGames.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Transfer Activity by Game Push</h2>
            <p className="text-xs text-slate-400 mt-0.5">Transfers made between each game push</p>
          </div>
          {trendsByGame.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No transfer activity recorded yet</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {processedGames.map((pg) => {
                const trends = trendsByGameMap.get(pg.id) ?? [];
                if (trends.length === 0) return null;
                const totalIn = trends.reduce((s, t) => s + t.transfersIn, 0);
                const totalOut = trends.reduce((s, t) => s + t.transfersOut, 0);
                const topMover = [...trends].sort((a, b) => (b.transfersIn + b.transfersOut) - (a.transfersIn + a.transfersOut))[0];
                return (
                  <div key={pg.id} className="px-5 py-3 flex items-center justify-between text-sm gap-4">
                    <div>
                      <p className="text-slate-600 font-medium text-xs">
                        {new Date(pg.processedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                      {topMover && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          Top mover: {playerNames.get(topMover.playerId) ?? "Unknown"}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs">
                      <span className="text-green-600 font-semibold">+{totalIn} in</span>
                      <span className="text-red-500 font-semibold">{totalOut} out</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Recent transfer activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Recent Transfers</h2>
          </div>
          {recentTransfers.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No transfers yet</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {recentTransfers.map((t) => {
                const team = teamMap.get(t.fantasyTeamId);
                const manager = team ? memberNames.get(team.user.memberUserId) ?? team.user.teamName : "Unknown";
                return (
                  <div key={t.id} className="px-5 py-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-slate-500 text-xs font-medium">{manager}</p>
                        <p className="text-green-600 text-xs mt-0.5">
                          ↑ {playerNames.get(t.playerInId) ?? "Unknown"}
                        </p>
                        <p className="text-red-500 text-xs">
                          ↓ {playerNames.get(t.playerOutId) ?? "Unknown"}
                        </p>
                      </div>
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        {new Date(t.transferDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Transfers by Manager</h2>
          </div>
          {transfersPerManager.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No managers yet</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {transfersPerManager.map((m, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-slate-800">{m.teamName}</p>
                    <p className="text-xs text-slate-400">{m.managerName}</p>
                  </div>
                  <span className="font-bold text-ndsc-navy text-sm">{m.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-lg font-black text-ndsc-navy mt-1 truncate">{value}</p>
    </div>
  );
}

function TransferList({ title, items }: {
  title: string;
  items: { name: string; value: string; positive: boolean }[];
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-300">No data yet</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between text-sm gap-2">
              <span className="text-slate-700 truncate">{item.name}</span>
              <span className={`text-xs font-bold flex-shrink-0 ${item.positive ? "text-green-600" : "text-red-500"}`}>
                {item.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
