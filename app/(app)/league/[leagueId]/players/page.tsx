import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { notFound } from "next/navigation";
import { SignPlayerButton } from "./sign-player-button";
import { getWeekStart } from "@/app/lib/scoring";
import {
  getPlayerListForSeason,
  getPlayerMetasForLeague,
  getLeagueTeamCount,
  getOwnershipForLeague,
} from "@/app/lib/cached-queries";

export const dynamic = 'force-dynamic';
export const metadata = { title: "Players — NDSC Fantasy" };

export default async function PlayersPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ search?: string; gender?: string; team?: string; replacing?: string }>;
}) {
  const [{ leagueId }, { search, gender, team, replacing }] = await Promise.all([params, searchParams]);

  // Wave 1 — session + league in parallel (both needed before anything else)
  const [session, league] = await Promise.all([
    requireSession(),
    db.fantasyLeague.findUnique({ where: { id: leagueId } }),
  ]);
  if (!league) notFound();

  const windowClosed = !league.transferWindowOpen ||
    (league.windowClosesAt != null && new Date() >= league.windowClosesAt);
  const squadSize = league.squadSize ?? 7;
  const seasonId = league.mainSeasonId;

  // Wave 2 — cached shared data + user-specific upsert, all in parallel.
  // playerData, metas, totalTeams come from the server cache (shared across all users).
  const [playerData, metas, totalTeams, fantasyUser] = await Promise.all([
    getPlayerListForSeason(seasonId),
    getPlayerMetasForLeague(leagueId),
    getLeagueTeamCount(leagueId),
    db.fantasyUser.upsert({
      where: { memberUserId: session.memberUserId },
      create: { memberUserId: session.memberUserId, teamName: "My Fantasy Team" },
      update: {},
    }),
  ]);

  // Apply filters in-memory (no extra DB round-trip)
  let players = playerData.players;
  if (search) {
    const q = search.toLowerCase();
    players = players.filter((p) => p.display_name.toLowerCase().includes(q));
  }
  if (gender) players = players.filter((p) => p.gender?.toLowerCase() === gender.toLowerCase());
  if (team) players = players.filter((p) => p.team_name === team);

  const playerIds = players.map((p) => p.id);
  const allTeams = playerData.teamNames;

  // Wave 3 — ownership (cached) + team record (user-specific) in parallel
  const [ownershipCounts, fantasyTeam] = await Promise.all([
    getOwnershipForLeague(leagueId, playerIds),
    db.fantasyTeam.upsert({
      where: { fantasyUserId_leagueId: { fantasyUserId: fantasyUser.id, leagueId } },
      create: { fantasyUserId: fantasyUser.id, leagueId, currentBudget: Number(league.startingBudget) },
      update: {},
      include: { roster: true },
    }),
  ]);

  const metaMap = new Map(
    metas.map((m) => [m.playerId, {
      currentPrice: Number(m.currentPrice),
      fantasyRating: m.fantasyRating,
      status: m.status,
    }])
  );
  const ownershipMap = new Map(
    ownershipCounts.map((o) => [
      o.playerId,
      totalTeams > 0 ? Math.round((o._count.playerId / totalTeams) * 100) : 0,
    ])
  );

  const rosterIds = new Set(fantasyTeam.roster.map((r) => r.playerId));
  const budget = Number(fantasyTeam.currentBudget);
  const squadFull = fantasyTeam.roster.length >= squadSize;

  // Resolve transfer mode entry (in-memory, no extra query)
  const rosterOutRoster = replacing ? fantasyTeam.roster.find((r) => r.id === replacing) : null;
  const rosterOutEntry = rosterOutRoster
    ? { id: rosterOutRoster.id, playerId: rosterOutRoster.playerId, currentPrice: Number(rosterOutRoster.currentPrice) }
    : null;
  const effectiveBudget = budget + (rosterOutEntry?.currentPrice ?? 0);

  // Wave 4 — weekly transfer count + replacing player name in parallel
  const weekStart = getWeekStart();
  const pool = getMainDb();
  const [thisWeekTransfers, rosterOutNameRes] = await Promise.all([
    db.fantasyTransfer.count({
      where: { fantasyTeamId: fantasyTeam.id, transferDate: { gte: weekStart } },
    }),
    rosterOutEntry?.playerId
      ? pool.query<{ display_name: string }>(
          "SELECT display_name FROM players WHERE id = $1",
          [rosterOutEntry.playerId]
        )
      : Promise.resolve(null),
  ]);
  const rosterOutPlayerName = rosterOutNameRes?.rows[0]?.display_name ?? (rosterOutEntry ? "player" : null);

  const isTransferMode = !!rosterOutEntry;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Players</h1>
        <p className="text-slate-500 text-sm mt-0.5">Browse, filter, and sign players</p>
      </div>

      {/* Transfer window closed banner */}
      {windowClosed && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">Transfer window is closed</p>
          <p className="text-xs text-red-600 mt-0.5">
            Signing and transfers are currently disabled. The window will reopen before the next deadline — check back soon.
          </p>
        </div>
      )}

      {/* Transfer mode banner */}
      {isTransferMode && rosterOutPlayerName && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-amber-800">
              Transfer mode — transferring out {rosterOutPlayerName}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              You will receive £{rosterOutEntry!.currentPrice.toFixed(1)}M back.
              Effective budget: £{effectiveBudget.toFixed(1)}M
              {thisWeekTransfers >= 1 && (
                <span className="ml-2 text-red-600 font-semibold">⚠️ Extra transfer — −15 pts</span>
              )}
            </p>
          </div>
          <a
            href={`/league/${leagueId}/players`}
            className="text-xs font-medium text-amber-700 underline whitespace-nowrap"
          >
            Cancel transfer
          </a>
        </div>
      )}

      <form method="GET" className="flex flex-wrap gap-3 items-center">
        <input
          name="search"
          defaultValue={search}
          placeholder="Search player…"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20 w-48"
        />
        <select
          name="gender"
          defaultValue={gender}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
        >
          <option value="">All genders</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <select
          name="team"
          defaultValue={team}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
        >
          <option value="">All teams</option>
          {allTeams.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {replacing && <input type="hidden" name="replacing" value={replacing} />}
        <button
          type="submit"
          className="rounded-lg bg-ndsc-navy text-white px-4 py-2 text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          Filter
        </button>
        {(search || gender || team) && (
          <a
            href={replacing ? `/league/${leagueId}/players?replacing=${replacing}` : `/league/${leagueId}/players`}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Clear
          </a>
        )}
      </form>

      <div className="bg-ndsc-navy/5 border border-ndsc-navy/20 rounded-lg px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
        <span>
          <strong className="text-ndsc-navy">Budget:</strong>{" "}
          {isTransferMode ? (
            <>£{effectiveBudget.toFixed(1)}M effective</>
          ) : (
            <>£{budget.toFixed(1)}M remaining</>
          )}
        </span>
        <span>
          <strong className="text-ndsc-navy">Squad:</strong> {fantasyTeam.roster.length}/{squadSize} players
        </span>
        <span>
          <strong className="text-ndsc-navy">Free transfers:</strong>{" "}
          {thisWeekTransfers === 0
            ? "1 remaining this week"
            : <span className="text-red-600">{thisWeekTransfers} used — extras cost −15 pts</span>}
        </span>
        {squadFull && !isTransferMode && (
          <span className="text-amber-600 font-medium">Squad full — use Transfer to swap</span>
        )}
      </div>

      {/* Badge legend */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="bg-ndsc-green text-white px-1.5 py-0.5 rounded font-bold">ROOKIE</span>
          2× points multiplier
        </span>
        <span className="flex items-center gap-1">
          <span className="bg-purple-600 text-white px-1.5 py-0.5 rounded font-bold">DIFF</span>
          Differential — owned by &lt;20% of managers
        </span>
        <span className="flex items-center gap-1">
          <span className="bg-pink-500 text-white px-1.5 py-0.5 rounded font-bold">F</span>
          Female — build &gt;50% female squad for +3 pts/game bonus
        </span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 font-medium text-slate-500">Player</th>
                <th className="text-left px-3 py-3 font-medium text-slate-500">Team</th>
                <th className="text-right px-3 py-3 font-medium text-slate-500">Price</th>
                <th className="text-right px-3 py-3 font-medium text-slate-500">Rating</th>
                <th className="text-right px-3 py-3 font-medium text-slate-500">Owned</th>
                <th className="text-right px-5 py-3 font-medium text-slate-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {players.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    No players found
                  </td>
                </tr>
              )}
              {players.map((p) => {
                const meta = metaMap.get(p.id) ?? { currentPrice: 3.0, fantasyRating: 50, status: "active" };
                const inSquad = rosterIds.has(p.id);
                const isBeingReplaced = rosterOutEntry?.playerId === p.id;
                const canAfford = isTransferMode
                  ? meta.currentPrice <= effectiveBudget
                  : meta.currentPrice <= budget;
                const isRookie = p.squad_status === "rookie" || p.squad_status === "development";
                const isFemale = p.gender?.toLowerCase() === "female";
                const ownership = ownershipMap.get(p.id) ?? 0;
                const isDifferential = totalTeams > 1 && ownership > 0 && ownership < 20;

                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-slate-50 transition-colors ${isBeingReplaced ? "opacity-40" : ""} ${isRookie ? "bg-ndsc-green/5" : ""}`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center flex-shrink-0 ${
                          isFemale ? "bg-pink-100 text-pink-700" : "bg-ndsc-navy/10 text-ndsc-navy"
                        }`}>
                          {p.display_name[0]}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{p.display_name}</p>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            {isRookie && (
                              <span className="bg-ndsc-green text-white text-xs px-1.5 py-0.5 rounded font-bold leading-none">
                                ROOKIE 2×
                              </span>
                            )}
                            {isDifferential && (
                              <span className="bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded font-bold leading-none">
                                DIFF
                              </span>
                            )}
                            {isFemale && (
                              <span className="bg-pink-500 text-white text-xs px-1.5 py-0.5 rounded font-bold leading-none">
                                F
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-500">{p.team_name ?? "—"}</td>
                    <td className="px-3 py-3 text-right font-bold text-slate-800">
                      £{meta.currentPrice.toFixed(1)}M
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={`font-semibold ${meta.fantasyRating >= 70 ? "text-green-600" : meta.fantasyRating >= 50 ? "text-amber-500" : "text-red-500"}`}>
                        {meta.fantasyRating}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-500">
                      {ownership}%
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isBeingReplaced ? (
                        <span className="text-xs text-slate-400">Transferring out</span>
                      ) : inSquad ? (
                        <span className="text-xs text-green-600 font-medium">In squad</span>
                      ) : meta.status !== "active" ? (
                        <span className="text-xs text-slate-400 capitalize">{meta.status.replace("_", " ")}</span>
                      ) : isTransferMode ? (
                        <SignPlayerButton
                          playerId={p.id}
                          playerName={p.display_name}
                          price={meta.currentPrice}
                          disabled={windowClosed || !canAfford}
                          disabledReason={
                            windowClosed ? "Transfer window closed"
                            : !canAfford ? "Insufficient budget"
                            : undefined
                          }
                          teamId={fantasyTeam.id}
                          leagueId={leagueId}
                          replacingRosterId={rosterOutEntry!.id}
                          replacingPlayerName={rosterOutPlayerName ?? undefined}
                          isExtraTransfer={thisWeekTransfers >= 1}
                        />
                      ) : (
                        <SignPlayerButton
                          playerId={p.id}
                          playerName={p.display_name}
                          price={meta.currentPrice}
                          disabled={windowClosed || squadFull || !canAfford}
                          disabledReason={
                            windowClosed ? "Transfer window closed"
                            : squadFull ? "Squad full — use Transfer from My Team"
                            : !canAfford ? "Insufficient budget"
                            : undefined
                          }
                          teamId={fantasyTeam.id}
                          leagueId={leagueId}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
