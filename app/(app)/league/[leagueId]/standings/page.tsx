import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { notFound } from "next/navigation";

export const metadata = { title: "Standings — NDSC Fantasy" };

export default async function StandingsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  await requireSession();

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const pool = getMainDb();

  const teams = await db.fantasyTeam.findMany({
    where: { leagueId },
    orderBy: { totalPoints: "desc" },
    include: { user: true },
  });

  const fantasyUserIds = teams.map((t) => t.user.memberUserId);
  let memberNames: { id: string; display_name: string }[] = [];
  if (fantasyUserIds.length > 0) {
    const res = await pool.query<{ id: string; display_name: string }>(
      `SELECT u.id, COALESCE(p.display_name, u.email) as display_name
       FROM users u
       LEFT JOIN players p ON p.id = u.player_id
       WHERE u.id = ANY($1::uuid[])`,
      [fantasyUserIds]
    );
    memberNames = res.rows;
  }

  const latestGame = await db.fantasyProcessedGame.findFirst({
    where: { leagueId },
    orderBy: { processedAt: "desc" },
  });

  const latestGameScores = latestGame
    ? await db.fantasyScore.groupBy({
        by: ["playerId"],
        where: { processedGameId: latestGame.id },
        _sum: { fantasyPoints: true },
        orderBy: { _sum: { fantasyPoints: "desc" } },
        take: 10,
      })
    : [];

  const mostCaptained = await db.fantasyRoster.groupBy({
    by: ["playerId"],
    where: { isCaptain: true, team: { leagueId } },
    _count: { playerId: true },
    orderBy: { _count: { playerId: "desc" } },
    take: 3,
  });

  const mostOwned = await db.fantasyRoster.groupBy({
    by: ["playerId"],
    _count: { playerId: true },
    where: { team: { leagueId } },
    orderBy: { _count: { playerId: "desc" } },
    take: 3,
  });

  const allPlayerIds = [
    ...new Set([
      ...mostCaptained.map((m) => m.playerId),
      ...mostOwned.map((m) => m.playerId),
    ]),
  ];
  let playerNames: { id: string; display_name: string }[] = [];
  if (allPlayerIds.length > 0) {
    const pRes = await pool.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])",
      [allPlayerIds]
    );
    playerNames = pRes.rows;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{league.name}</h1>
        <p className="text-slate-500 text-sm mt-0.5">Overall standings and statistics</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">League Table</h2>
          </div>
          {teams.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              No managers have joined yet
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-5 py-2.5 font-medium text-slate-500">#</th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-500">Manager</th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-500">Team</th>
                  <th className="text-right px-5 py-2.5 font-medium text-slate-500">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teams.map((t, i) => {
                  const manager = memberNames.find((m) => m.id === t.user.memberUserId);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            i === 0 ? "bg-ndsc-gold text-ndsc-navy"
                            : i === 1 ? "bg-slate-300 text-slate-700"
                            : i === 2 ? "bg-amber-700/30 text-amber-800"
                            : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{manager?.display_name ?? "Unknown"}</td>
                      <td className="px-3 py-3 font-medium text-slate-800">{t.user.teamName}</td>
                      <td className="px-5 py-3 text-right font-black text-ndsc-navy text-base">
                        {t.totalPoints}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="space-y-4">
          <MiniCard title="Most Captained">
            {mostCaptained.length === 0 ? (
              <p className="text-slate-400 text-xs">No data yet</p>
            ) : (
              mostCaptained.map((m) => (
                <div key={m.playerId} className="flex justify-between text-sm">
                  <span className="text-slate-700">
                    {playerNames.find((p) => p.id === m.playerId)?.display_name ?? "—"}
                  </span>
                  <span className="font-semibold text-ndsc-navy">{m._count.playerId} teams</span>
                </div>
              ))
            )}
          </MiniCard>

          <MiniCard title="Most Owned">
            {mostOwned.length === 0 ? (
              <p className="text-slate-400 text-xs">No data yet</p>
            ) : (
              mostOwned.map((m) => (
                <div key={m.playerId} className="flex justify-between text-sm">
                  <span className="text-slate-700">
                    {playerNames.find((p) => p.id === m.playerId)?.display_name ?? "—"}
                  </span>
                  <span className="font-semibold text-ndsc-navy">{m._count.playerId} teams</span>
                </div>
              ))
            )}
          </MiniCard>

          <MiniCard title="Last Pushed Game">
            {!latestGame ? (
              <p className="text-slate-400 text-xs">No games pushed yet</p>
            ) : (
              <div>
                <p className="text-xs text-slate-400 mb-2">
                  {new Date(latestGame.processedAt).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric",
                  })}
                </p>
                <p className="text-xs text-slate-500">
                  {latestGameScores.length} player scores recorded
                </p>
              </div>
            )}
          </MiniCard>
        </div>
      </div>
    </div>
  );
}

function MiniCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <h3 className="font-semibold text-slate-700 text-sm mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
