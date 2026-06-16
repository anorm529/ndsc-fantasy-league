import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { notFound } from "next/navigation";
import { AWARD_DEFS } from "@/app/lib/awards";

export const dynamic = 'force-dynamic';
export const metadata = { title: "Awards — NDSC Fantasy" };

export default async function AwardsPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  await requireSession();
  const pool = getMainDb();

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const awards = await db.fantasyAward.findMany({
    where: { leagueId },
    orderBy: { generatedAt: "desc" },
  });

  // Get winner team info
  const winnerTeamIds = [...new Set(awards.filter((a) => a.winnerTeamId).map((a) => a.winnerTeamId!))];
  const winnerPlayerIds = [...new Set(awards.filter((a) => a.winnerPlayerId).map((a) => a.winnerPlayerId!))];

  const teamInfoMap = new Map<string, { teamName: string; managerName: string }>();
  if (winnerTeamIds.length > 0) {
    const teams = await db.fantasyTeam.findMany({
      where: { id: { in: winnerTeamIds } },
      include: { user: true },
    });
    const memberIds = teams.map((t) => t.user.memberUserId);
    const membersRes = memberIds.length > 0
      ? await pool.query<{ id: string; name: string }>(
          `SELECT u.id, COALESCE(p.display_name, u.email) as name
           FROM users u LEFT JOIN players p ON p.id = u.player_id
           WHERE u.id = ANY($1::uuid[])`,
          [memberIds]
        )
      : { rows: [] };
    for (const t of teams) {
      const member = membersRes.rows.find((m) => m.id === t.user.memberUserId);
      teamInfoMap.set(t.id, { teamName: t.user.teamName, managerName: member?.name ?? "Unknown" });
    }
  }

  const playerNameMap = new Map<string, string>();
  if (winnerPlayerIds.length > 0) {
    const res = await pool.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])",
      [winnerPlayerIds]
    );
    for (const r of res.rows) playerNameMap.set(r.id, r.display_name);
  }

  // Map awards by name for easy lookup
  const awardByName = new Map(awards.map((a) => [a.awardName, a]));

  const generatedAt = awards[0]?.generatedAt;
  const hasAwards = awards.length > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Season Awards</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {hasAwards
              ? `Generated ${new Date(generatedAt!).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
              : "Awards are generated at season end by the admin."}
          </p>
        </div>
        {hasAwards && (
          <div className="bg-ndsc-gold/10 border border-ndsc-gold/30 rounded-lg px-4 py-2 text-sm text-amber-700 font-medium">
            {league.name}
          </div>
        )}
      </div>

      {!hasAwards ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center shadow-sm">
          <div className="text-5xl mb-4">🏆</div>
          <p className="text-slate-600 font-semibold text-lg">No awards yet</p>
          <p className="text-slate-400 text-sm mt-2">
            Awards will be calculated and published at the end of the season.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AWARD_DEFS.map((def) => {
            const award = awardByName.get(def.name);
            if (!award) return null;

            const teamInfo = award.winnerTeamId ? teamInfoMap.get(award.winnerTeamId) : null;
            const playerName = award.winnerPlayerId ? playerNameMap.get(award.winnerPlayerId) : null;
            const winnerName = teamInfo?.teamName ?? playerName ?? award.details ?? "Unknown";
            const subName = teamInfo?.managerName;

            return (
              <div
                key={def.name}
                className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{def.emoji}</span>
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{def.name}</p>
                    <p className="text-xs text-slate-400">{def.desc}</p>
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-3">
                  <p className="font-bold text-ndsc-navy text-base leading-tight">{winnerName}</p>
                  {subName && <p className="text-xs text-slate-400 mt-0.5">{subName}</p>}
                  <p className="text-xs font-semibold text-ndsc-gold mt-2">{award.value}</p>
                  {award.details && award.details !== winnerName && (
                    <p className="text-xs text-slate-400 mt-0.5">{award.details}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
