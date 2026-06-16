import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { notFound } from "next/navigation";
import { SignPlayerButton } from "./sign-player-button";
import { getWeekStart } from "@/app/lib/scoring";

export const metadata = { title: "Players — NDSC Fantasy" };

type PlayerRow = {
  id: string;
  display_name: string;
  gender: string | null;
  squad_status: string | null;
  team_name: string | null;
};

export default async function PlayersPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ search?: string; gender?: string; team?: string; replacing?: string }>;
}) {
  const { leagueId } = await params;
  const { search, gender, team, replacing } = await searchParams;

  const session = await requireSession();
  const pool = getMainDb();

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const transferWindowOpen = league.transferWindowOpen;

  const seasonId = league.mainSeasonId;

  const playerRes = await pool.query<PlayerRow>(
    `SELECT DISTINCT ON (p.id)
       p.id, p.display_name, p.gender,
       pts.squad_status,
       t.name as team_name
     FROM player_season_stats pss
     JOIN players p ON p.id = pss.player_id
     LEFT JOIN player_team_seasons pts
       ON pts.player_id = p.id AND pts.season_id = pss.season_id
     LEFT JOIN teams t ON t.id = pts.team_id
     WHERE pss.season_id = $1
       AND p.active = true
     ORDER BY p.id`,
    [seasonId]
  );

  let players = playerRes.rows;

  if (search) {
    const q = search.toLowerCase();
    players = players.filter((p) => p.display_name.toLowerCase().includes(q));
  }
  if (gender) {
    players = players.filter((p) => p.gender?.toLowerCase() === gender.toLowerCase());
  }
  if (team) {
    players = players.filter((p) => p.team_name === team);
  }

  const teamsRes = await pool.query<{ name: string }>(
    `SELECT DISTINCT t.name
     FROM player_team_seasons pts
     JOIN teams t ON t.id = pts.team_id
     WHERE pts.season_id = $1
     ORDER BY t.name`,
    [seasonId]
  );
  const allTeams = teamsRes.rows.map((t) => t.name);

  const playerIds = players.map((p) => p.id);
  const metaMap = new Map<string, { currentPrice: number; fantasyRating: number; status: string }>();

  if (playerIds.length > 0) {
    const metas = await db.fantasyPlayerMeta.findMany({
      where: { leagueId, playerId: { in: playerIds } },
    });
    for (const m of metas) {
      metaMap.set(m.playerId, {
        currentPrice: Number(m.currentPrice),
        fantasyRating: m.fantasyRating,
        status: m.status,
      });
    }
  }

  const fantasyUser = await db.fantasyUser.findUnique({
    where: { memberUserId: session.memberUserId },
  });

  const fantasyTeam = fantasyUser
    ? await db.fantasyTeam.findUnique({
        where: { fantasyUserId_leagueId: { fantasyUserId: fantasyUser.id, leagueId } },
        include: { roster: true },
      })
    : null;

  const rosterIds = new Set(fantasyTeam?.roster.map((r) => r.playerId) ?? []);
  const budget = Number(fantasyTeam?.currentBudget ?? 50.0);
  const squadFull = (fantasyTeam?.roster.length ?? 0) >= 7;

  // Weekly transfer count (for extra transfer warning)
  let thisWeekTransfers = 0;
  if (fantasyTeam) {
    const weekStart = getWeekStart();
    thisWeekTransfers = await db.fantasyTransfer.count({
      where: { fantasyTeamId: fantasyTeam.id, transferDate: { gte: weekStart } },
    });
  }

  // Transfer mode — look up the roster entry being replaced
  let rosterOutEntry: { id: string; playerId: string; currentPrice: number } | null = null;
  let rosterOutPlayerName: string | null = null;
  let effectiveBudget = budget;

  if (replacing && fantasyTeam) {
    const entry = fantasyTeam.roster.find((r) => r.id === replacing);
    if (entry) {
      rosterOutEntry = { id: entry.id, playerId: entry.playerId, currentPrice: Number(entry.currentPrice) };
      effectiveBudget = budget + rosterOutEntry.currentPrice;

      if (rosterOutEntry.playerId) {
        const pRes = await pool.query<{ display_name: string }>(
          "SELECT display_name FROM players WHERE id = $1",
          [rosterOutEntry.playerId]
        );
        rosterOutPlayerName = pRes.rows[0]?.display_name ?? "player";
      }
    }
  }

  const totalTeams = await db.fantasyTeam.count({ where: { leagueId } });
  const ownershipCounts = await db.fantasyRoster.groupBy({
    by: ["playerId"],
    _count: { playerId: true },
    where: {
      playerId: { in: playerIds },
      team: { leagueId },
    },
  });
  const ownershipMap = new Map(
    ownershipCounts.map((o) => [
      o.playerId,
      totalTeams > 0 ? Math.round((o._count.playerId / totalTeams) * 100) : 0,
    ])
  );

  const isTransferMode = !!rosterOutEntry;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Players</h1>
        <p className="text-slate-500 text-sm mt-0.5">Browse, filter, and sign players</p>
      </div>

      {/* Transfer window closed banner */}
      {!transferWindowOpen && (
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

      {fantasyTeam && (
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
            <strong className="text-ndsc-navy">Squad:</strong> {fantasyTeam.roster.length}/7 players
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
      )}

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
                          disabled={!transferWindowOpen || !canAfford || !fantasyTeam}
                          disabledReason={
                            !transferWindowOpen ? "Transfer window closed"
                            : !fantasyTeam ? "Create team first"
                            : !canAfford ? "Insufficient budget"
                            : undefined
                          }
                          teamId={fantasyTeam?.id}
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
                          disabled={!transferWindowOpen || squadFull || !canAfford || !fantasyTeam}
                          disabledReason={
                            !transferWindowOpen ? "Transfer window closed"
                            : !fantasyTeam ? "Create team first"
                            : squadFull ? "Squad full — use Transfer from My Team"
                            : !canAfford ? "Insufficient budget"
                            : undefined
                          }
                          teamId={fantasyTeam?.id}
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
