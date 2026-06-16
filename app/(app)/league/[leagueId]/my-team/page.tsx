import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SetCaptainButton } from "./set-captain-button";
import { RemovePlayerButton } from "./remove-player-button";

export const metadata = { title: "My Team — NDSC Fantasy" };

export default async function MyTeamPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const session = await requireSession();

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const pool = getMainDb();

  let fantasyUser = await db.fantasyUser.findUnique({
    where: { memberUserId: session.memberUserId },
  });
  if (!fantasyUser) {
    fantasyUser = await db.fantasyUser.create({
      data: { memberUserId: session.memberUserId, teamName: "My Fantasy Team" },
    });
  }

  let team = await db.fantasyTeam.findUnique({
    where: { fantasyUserId_leagueId: { fantasyUserId: fantasyUser.id, leagueId } },
    include: { roster: true },
  });

  if (!team) {
    team = await db.fantasyTeam.create({
      data: { fantasyUserId: fantasyUser.id, leagueId, currentBudget: Number(league.startingBudget) },
      include: { roster: true },
    });
  }

  const rosterPlayerIds = team.roster.map((r) => r.playerId);
  let playerDetails: {
    id: string;
    display_name: string;
    gender: string | null;
    team_name: string | null;
  }[] = [];

  if (rosterPlayerIds.length > 0) {
    const pRes = await pool.query<{
      id: string;
      display_name: string;
      gender: string | null;
      team_name: string | null;
    }>(
      `SELECT DISTINCT ON (p.id) p.id, p.display_name, p.gender, t.name as team_name
       FROM players p
       LEFT JOIN player_team_seasons pts ON pts.player_id = p.id
       LEFT JOIN teams t ON t.id = pts.team_id
       WHERE p.id = ANY($1::uuid[])
       ORDER BY p.id, p.display_name`,
      [rosterPlayerIds]
    );
    playerDetails = pRes.rows;
  }

  const budget = Number(team.currentBudget);
  const squadValue = team.roster.reduce((sum, r) => sum + Number(r.currentPrice), 0);
  const totalPurchased = team.roster.reduce((sum, r) => sum + Number(r.purchasePrice), 0);
  const totalPnl = squadValue - totalPurchased;
  const captain = team.roster.find((r) => r.isCaptain);

  const ruleViolations: string[] = [];
  if (team.roster.length < 5) {
    ruleViolations.push(`Need ${5 - team.roster.length} more player(s) to have a complete squad.`);
  }
  if (!captain) ruleViolations.push("No captain selected.");

  const femaleCount = playerDetails.filter((p) => p.gender?.toLowerCase() === "female").length;
  if (team.roster.length > 0 && femaleCount < 2) {
    ruleViolations.push(`Need at least 2 female players (currently ${femaleCount}).`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Team</h1>
        <p className="text-slate-500 text-sm mt-0.5">Manage your squad, captain, and transfers</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-wrap gap-6">
          <BudgetStat label="Remaining Budget" value={`£${budget.toFixed(1)}M`} />
          <BudgetStat label="Squad Value" value={`£${squadValue.toFixed(1)}M`} />
          <BudgetStat label="Players" value={`${team.roster.length} / 5`} />
          <BudgetStat
            label="Season P&L"
            value={`${totalPnl >= 0 ? "+" : ""}£${totalPnl.toFixed(1)}M`}
            valueClass={totalPnl > 0 ? "text-green-600" : totalPnl < 0 ? "text-red-500" : undefined}
          />
          <BudgetStat
            label="Captain"
            value={captain ? (playerDetails.find((p) => p.id === captain.playerId)?.display_name ?? "—") : "Not set"}
          />
        </div>
      </div>

      {ruleViolations.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">Squad Requirements</p>
          <ul className="text-sm text-amber-700 space-y-0.5 list-disc list-inside">
            {ruleViolations.map((v, i) => <li key={i}>{v}</li>)}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Your Squad</h2>
          <a
            href={`/league/${leagueId}/players`}
            className="text-xs text-ndsc-navy font-medium hover:underline"
          >
            Add players →
          </a>
        </div>

        {team.roster.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-400 mb-3">Your squad is empty</p>
            <a
              href={`/league/${leagueId}/players`}
              className="inline-block rounded-lg bg-ndsc-navy text-white text-sm px-4 py-2 font-medium"
            >
              Browse Players
            </a>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {team.roster.map((r) => {
              const player = playerDetails.find((p) => p.id === r.playerId);
              const currentPrice = Number(r.currentPrice);
              const purchasePrice = Number(r.purchasePrice);
              const pnl = currentPrice - purchasePrice;

              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-ndsc-navy/10 flex items-center justify-center text-ndsc-navy font-bold text-sm flex-shrink-0">
                      {player?.display_name?.[0] ?? "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        {player?.display_name ?? "Unknown"}
                        {r.isCaptain && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-ndsc-gold text-ndsc-navy">
                            C
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400">
                        {player?.team_name ?? "—"} · {player?.gender ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-700">
                        £{currentPrice.toFixed(1)}M
                      </p>
                      <p className={`text-xs font-medium ${pnl > 0 ? "text-green-600" : pnl < 0 ? "text-red-500" : "text-slate-400"}`}>
                        {pnl > 0 ? "+" : ""}{pnl !== 0 ? `£${pnl.toFixed(1)}M` : "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!r.isCaptain && (
                        <SetCaptainButton teamId={team!.id} rosterId={r.id} leagueId={leagueId} />
                      )}
                      <Link
                        href={`/league/${leagueId}/players?replacing=${r.id}`}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-700 font-medium hover:bg-amber-200 transition-colors"
                      >
                        Transfer
                      </Link>
                      <RemovePlayerButton teamId={team!.id} rosterId={r.id} leagueId={leagueId} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-slate-800 rounded-xl p-5 text-white text-sm">
        <h3 className="font-semibold mb-2 text-ndsc-gold">Squad Rules</h3>
        <ul className="space-y-1 text-slate-300 text-xs">
          <li>• Exactly 5 players · max 2 from any one NDSC team</li>
          <li>• Minimum 2 female players · minimum 1 rookie/development player</li>
          <li>• Budget: £40.0M · 1 free transfer per week (extras cost -4 pts)</li>
          <li>• Captain scores 2× fantasy points</li>
        </ul>
      </div>
    </div>
  );
}

function BudgetStat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <p className="text-xs text-slate-400 font-medium">{label}</p>
      <p className={`text-lg font-bold ${valueClass ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}
