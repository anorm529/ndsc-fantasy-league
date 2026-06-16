import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { logoutAction } from "@/app/lib/actions";
import { GeneratePricesButton } from "./generate-prices-button";
import { ArchiveLeagueButton } from "./archive-league-button";
import { PushGameButton } from "./push-game-button";
import { SetPlayerPriceForm } from "./set-player-price-form";
import { SetPlayerStatusForm } from "./set-player-status-form";
import { GenerateAwardsButton } from "./generate-awards-button";
import { updateLeagueStatusAction, toggleTransferWindowAction, toggleDoublePointsAction, updateLeagueSettingsAction } from "./actions";

type GameRow = {
  id: string;
  game_date: string;
  opponent: string | null;
  home_away: string | null;
  result: string | null;
  runs_for: number | null;
  runs_against: number | null;
  status: string | null;
  team_name: string;
  stat_count: number;
};

export async function generateMetadata({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  return { title: `${league?.name ?? "League"} Admin — NDSC Fantasy` };
}

export const dynamic = 'force-dynamic';
export default async function LeagueAdminPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const session = await requireSession();
  const pool = getMainDb();

  const userRes = await pool.query<{ display_name: string; role: string; email: string }>(
    `SELECT p.display_name, u.role, u.email
     FROM users u LEFT JOIN players p ON p.id = u.player_id
     WHERE u.id = $1`,
    [session.memberUserId]
  );
  const user = userRes.rows[0];
  if (user?.role !== "owner" && user?.role !== "admin") redirect("/home");

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const seasonId = league.mainSeasonId;

  // All games for this season from main DB, with stat count
  const gamesRes = await pool.query<GameRow>(`
    SELECT
      g.id::text,
      g.game_date::text,
      g.opponent,
      g.home_away,
      g.result,
      g.runs_for,
      g.runs_against,
      g.status,
      t.name AS team_name,
      COUNT(pgs.player_id)::int AS stat_count
    FROM games g
    JOIN teams t ON t.id = g.team_id
    LEFT JOIN player_game_stats pgs ON pgs.game_id = g.id
    WHERE g.season_id = $1
    GROUP BY g.id, g.game_date, g.opponent, g.home_away, g.result,
             g.runs_for, g.runs_against, g.status, t.name
    ORDER BY g.game_date ASC, t.name
  `, [seasonId]);

  const games = gamesRes.rows;

  // Which games have already been pushed for this league
  const pushedGames = await db.fantasyProcessedGame.findMany({
    where: { leagueId },
  });
  const pushedMap = new Map(pushedGames.map((pg) => [pg.gameId, pg]));

  // Player data for overrides
  const allPlayers = await pool.query<{ id: string; display_name: string; gender: string | null }>(
    `SELECT DISTINCT ON (p.id) p.id, p.display_name, p.gender
     FROM player_season_stats pss
     JOIN players p ON p.id = pss.player_id
     WHERE pss.season_id = $1 AND p.active = true
     ORDER BY p.id, p.display_name`,
    [seasonId]
  );

  const playerMetas = await db.fantasyPlayerMeta.findMany({ where: { leagueId } });
  const metaMap = new Map(playerMetas.map((m) => [m.playerId, m]));

  const auditLogs = await db.fantasyAuditLog.findMany({
    where: { leagueId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const auditUserIds = [...new Set(auditLogs.map((l) => l.adminUserId))];
  let auditUsers: { id: string; name: string }[] = [];
  if (auditUserIds.length > 0) {
    const res = await pool.query<{ id: string; name: string }>(
      `SELECT u.id, COALESCE(p.display_name, u.email) as name
       FROM users u LEFT JOIN players p ON p.id = u.player_id
       WHERE u.id = ANY($1::uuid[])`,
      [auditUserIds]
    );
    auditUsers = res.rows;
  }

  const totalManagers = await db.fantasyTeam.count({ where: { leagueId } });
  const pricedPlayers = playerMetas.length;
  const pushedCount = pushedGames.length;

  const ownershipGroups = await db.fantasyRoster.groupBy({
    by: ["playerId"],
    where: { team: { leagueId } },
    _count: { playerId: true },
  });
  const ownershipMap = new Map(
    ownershipGroups.map((o) => [o.playerId, o._count.playerId])
  );

  const prevSeasonRes = league.prevSeasonId
    ? await pool.query<{ year: number }>("SELECT year FROM seasons WHERE id = $1", [league.prevSeasonId])
    : null;
  const prevSeasonYear = prevSeasonRes?.rows[0]?.year;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-ndsc-navy shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/admin" className="text-slate-400 hover:text-white text-sm transition-colors">
                ← All Leagues
              </Link>
              <span className="text-slate-600">·</span>
              <span className="text-white font-semibold truncate max-w-xs">{league.name}</span>
              <Link
                href={`/league/${leagueId}/dashboard`}
                className="text-xs text-ndsc-gold/70 hover:text-ndsc-gold transition-colors ml-2"
              >
                View →
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-slate-400 text-sm hidden md:block">{user?.display_name ?? user?.email}</span>
              <form action={logoutAction}>
                <button type="submit" className="text-slate-400 hover:text-white text-sm transition-colors">Sign out</button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* League status banner */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{league.name}</h1>
              <p className="text-slate-500 text-sm">
                Status:{" "}
                <span className={`font-semibold ${
                  league.status === "active" ? "text-green-600"
                  : league.status === "closed" ? "text-slate-500"
                  : "text-amber-600"
                }`}>
                  {league.status}
                </span>
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {league.status !== "active" && (
                <form action={async () => { "use server"; await updateLeagueStatusAction(leagueId, "active"); }}>
                  <button type="submit" className="text-sm rounded-lg bg-green-600 text-white px-4 py-2 font-medium hover:bg-green-700 transition-colors">
                    Set Active
                  </button>
                </form>
              )}
              {league.status !== "closed" && (
                <ArchiveLeagueButton leagueId={leagueId} leagueName={league.name} />
              )}
              {league.status !== "draft" && (
                <form action={async () => { "use server"; await updateLeagueStatusAction(leagueId, "draft"); }}>
                  <button type="submit" className="text-sm rounded-lg border border-slate-300 text-slate-600 px-4 py-2 font-medium hover:bg-slate-50 transition-colors">
                    Back to Draft
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Transfer window toggle */}
          <div className={`flex items-center justify-between rounded-lg px-4 py-3 border ${
            league.transferWindowOpen
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }`}>
            <div>
              <p className={`text-sm font-semibold ${league.transferWindowOpen ? "text-green-800" : "text-red-800"}`}>
                Transfer Window: {league.transferWindowOpen ? "OPEN" : "CLOSED"}
              </p>
              <p className={`text-xs mt-0.5 ${league.transferWindowOpen ? "text-green-600" : "text-red-600"}`}>
                {league.transferWindowOpen
                  ? league.windowClosesAt
                    ? `Auto-closes ${new Date(league.windowClosesAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                    : "Managers can sign and transfer players."
                  : "All transfers are currently blocked. Managers cannot sign or transfer players."}
              </p>
            </div>
            <form action={async () => {
              "use server";
              await toggleTransferWindowAction(leagueId, !league.transferWindowOpen);
            }}>
              <button
                type="submit"
                className={`text-sm rounded-lg px-4 py-2 font-medium transition-colors ${
                  league.transferWindowOpen
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-green-600 text-white hover:bg-green-700"
                }`}
              >
                {league.transferWindowOpen ? "Close Window" : "Open Window"}
              </button>
            </form>
          </div>

          {/* Double points toggle */}
          <div className={`flex items-center justify-between rounded-lg px-4 py-3 border ${
            league.doublePointsActive
              ? "bg-ndsc-gold/10 border-ndsc-gold/40"
              : "bg-slate-50 border-slate-200"
          }`}>
            <div>
              <p className={`text-sm font-semibold ${league.doublePointsActive ? "text-amber-800" : "text-slate-700"}`}>
                Double Points Week: {league.doublePointsActive ? "ACTIVE" : "OFF"}
              </p>
              <p className={`text-xs mt-0.5 ${league.doublePointsActive ? "text-amber-600" : "text-slate-400"}`}>
                {league.doublePointsActive
                  ? "All scores from pushed games are doubled. A banner shows on the manager dashboard."
                  : "Enable before pushing games to double all fantasy points scored this week."}
              </p>
            </div>
            <form action={async () => {
              "use server";
              await toggleDoublePointsAction(leagueId, !league.doublePointsActive);
            }}>
              <button
                type="submit"
                className={`text-sm rounded-lg px-4 py-2 font-medium transition-colors ${
                  league.doublePointsActive
                    ? "bg-slate-600 text-white hover:bg-slate-700"
                    : "bg-ndsc-gold text-ndsc-navy hover:bg-yellow-400"
                }`}
              >
                {league.doublePointsActive ? "Turn Off" : "Enable"}
              </button>
            </form>
          </div>
        </div>

        {/* League settings */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-800 mb-4">League Settings</h2>
          <form action={updateLeagueSettingsAction.bind(null, leagueId)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Squad size</label>
              <input
                name="squad_size"
                type="number"
                min={1}
                max={20}
                defaultValue={league.squadSize}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Starting budget (£M)</label>
              <input
                name="starting_budget"
                type="number"
                min={1}
                max={200}
                step={0.5}
                defaultValue={Number(league.startingBudget)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Max players from same NDSC team</label>
              <input
                name="max_players_per_team"
                type="number"
                min={1}
                max={10}
                defaultValue={league.maxPlayersPerTeam}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Transfer window auto-closes at</label>
              <input
                name="window_closes_at"
                type="datetime-local"
                defaultValue={league.windowClosesAt
                  ? new Date(league.windowClosesAt).toISOString().slice(0, 16)
                  : ""}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
              />
              <p className="text-xs text-slate-400 mt-1">Leave blank for manual control only.</p>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-ndsc-navy text-white px-5 py-2 text-sm font-medium hover:bg-slate-700 transition-colors"
              >
                Save Settings
              </button>
            </div>
          </form>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <AdminStat label="Managers" value={totalManagers.toString()} />
          <AdminStat label="Players Priced" value={pricedPlayers.toString()} />
          <AdminStat label="Total Games" value={games.length.toString()} />
          <AdminStat label="Games Pushed" value={pushedCount.toString()} />
        </div>

        {/* Price generation */}
        <div className="bg-ndsc-navy rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-white font-semibold">Player Price Engine</p>
            <p className="text-slate-300 text-sm mt-0.5">
              {prevSeasonYear
                ? `Uses ${prevSeasonYear} end-of-season stats with 25% regression to mean. New players default to £4M.`
                : "Uses current season's live stats to price all active players."}
            </p>
          </div>
          <GeneratePricesButton leagueId={leagueId} hasPrevSeason={!!league.prevSeasonId} />
        </div>

        {/* Pricing breakdown */}
        {playerMetas.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">Player Pricing Breakdown</h2>
              <p className="text-xs text-slate-400 mt-0.5">All priced players sorted by Fantasy Rating. Ownership is current squad count.</p>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-5 py-2.5 font-medium text-slate-500">#</th>
                    <th className="text-left px-3 py-2.5 font-medium text-slate-500">Player</th>
                    <th className="text-left px-3 py-2.5 font-medium text-slate-500">Gender</th>
                    <th className="text-right px-3 py-2.5 font-medium text-slate-500">FR</th>
                    <th className="text-right px-3 py-2.5 font-medium text-slate-500">Price</th>
                    <th className="text-right px-3 py-2.5 font-medium text-slate-500">Owners</th>
                    <th className="text-right px-5 py-2.5 font-medium text-slate-500">Own %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {[...allPlayers.rows]
                    .filter((p) => metaMap.has(p.id))
                    .sort((a, b) => (metaMap.get(b.id)?.fantasyRating ?? 0) - (metaMap.get(a.id)?.fantasyRating ?? 0))
                    .map((p, i) => {
                      const meta = metaMap.get(p.id)!;
                      const owners = ownershipMap.get(p.id) ?? 0;
                      const ownPct = totalManagers > 0 ? Math.round((owners / totalManagers) * 100) : 0;
                      const fr = meta.fantasyRating;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="px-5 py-2 text-slate-400">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-slate-800">{p.display_name}</td>
                          <td className="px-3 py-2 text-slate-500 capitalize">{p.gender ?? "—"}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`font-bold ${fr >= 70 ? "text-green-600" : fr >= 50 ? "text-amber-500" : "text-red-500"}`}>
                              {fr}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">
                            £{Number(meta.currentPrice).toFixed(1)}M
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">{owners}</td>
                          <td className="px-5 py-2 text-right">
                            <span className={`font-medium ${ownPct >= 50 ? "text-amber-600" : ownPct < 20 && totalManagers > 1 ? "text-purple-600" : "text-slate-500"}`}>
                              {ownPct}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Games panel */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-800">Season Games</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Push a game once its scoresheet has been entered in the main system.
                Green = pushed. You can re-push any time if scores are updated.
              </p>
            </div>
          </div>

          {games.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              No games found for this season in the main database.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-500 uppercase tracking-wide">
                    <th className="text-left px-5 py-3">Date</th>
                    <th className="text-left px-3 py-3">Team</th>
                    <th className="text-left px-3 py-3">Opponent</th>
                    <th className="text-center px-3 py-3">H/A</th>
                    <th className="text-center px-3 py-3">Result</th>
                    <th className="text-center px-3 py-3">Stats</th>
                    <th className="text-right px-5 py-3">Fantasy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {games.map((g) => {
                    const pushed = pushedMap.get(g.id);
                    const hasStats = g.stat_count > 0;
                    const dateStr = g.game_date ? new Date(g.game_date).toLocaleDateString("en-GB", {
                      day: "numeric", month: "short", year: "numeric",
                    }) : "—";

                    return (
                      <tr
                        key={g.id}
                        className={`transition-colors ${pushed ? "bg-green-50 hover:bg-green-50/80" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{dateStr}</td>
                        <td className="px-3 py-3 font-medium text-slate-800">{g.team_name}</td>
                        <td className="px-3 py-3 text-slate-600">{g.opponent ?? "—"}</td>
                        <td className="px-3 py-3 text-center">
                          <span className="text-xs text-slate-400 capitalize">{g.home_away ?? "—"}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {g.result ? (
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                              g.result === "W" ? "bg-green-100 text-green-700"
                              : g.result === "L" ? "bg-red-100 text-red-600"
                              : "bg-slate-100 text-slate-500"
                            }`}>
                              {g.result}
                              {g.runs_for != null && g.runs_against != null
                                ? ` (${g.runs_for}–${g.runs_against})`
                                : ""}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">{g.status ?? "—"}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {hasStats ? (
                            <span className="text-xs font-medium text-green-600">{g.stat_count} players</span>
                          ) : (
                            <span className="text-xs text-slate-300">No stats</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {pushed ? (
                            <div className="flex items-center justify-end gap-3">
                              <span className="text-xs text-green-600 font-medium">
                                ✓ {pushed.scoreCount} scored
                              </span>
                              <PushGameButton
                                gameId={g.id}
                                leagueId={leagueId}
                                label={`${g.team_name} vs ${g.opponent ?? "opponent"} (${dateStr})`}
                                alreadyPushed={true}
                              />
                            </div>
                          ) : hasStats ? (
                            <PushGameButton
                              gameId={g.id}
                              leagueId={leagueId}
                              label={`${g.team_name} vs ${g.opponent ?? "opponent"} (${dateStr})`}
                              alreadyPushed={false}
                            />
                          ) : (
                            <span className="text-xs text-slate-300">Awaiting stats</span>
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

        {/* Awards */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-slate-800">Season Awards</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Awards are auto-generated when you archive the season. You can also generate them at any time for a mid-season preview.
              Awards are preserved after archiving.
            </p>
          </div>
          <GenerateAwardsButton leagueId={leagueId} />
        </div>

        {/* Player overrides */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">Player Overrides</h2>
            </div>
            <div className="p-5 space-y-4">
              <SetPlayerPriceForm
                leagueId={leagueId}
                players={allPlayers.rows}
                metaMap={Object.fromEntries(
                  [...metaMap.entries()].map(([k, v]) => [
                    k, { currentPrice: Number(v.currentPrice), fantasyRating: v.fantasyRating },
                  ])
                )}
              />
              <SetPlayerStatusForm
                leagueId={leagueId}
                players={allPlayers.rows}
                metaMap={Object.fromEntries(
                  [...metaMap.entries()].map(([k, v]) => [k, { status: v.status }])
                )}
              />
            </div>
          </div>

          {/* Audit log */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">Audit Log</h2>
            </div>
            {auditLogs.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">No admin actions yet</div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                {auditLogs.map((log) => {
                  const admin = auditUsers.find((u) => u.id === log.adminUserId);
                  return (
                    <div key={log.id} className="px-5 py-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-medium text-slate-800">{log.action}</span>
                          {log.details && (
                            <p className="text-slate-500 text-xs mt-0.5 truncate">{log.details}</p>
                          )}
                        </div>
                        <div className="text-right text-xs text-slate-400 flex-shrink-0">
                          <p>{admin?.name ?? "Unknown"}</p>
                          <p>{new Date(log.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function AdminStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-black text-ndsc-navy mt-1">{value}</p>
    </div>
  );
}
