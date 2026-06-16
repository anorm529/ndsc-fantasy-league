import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { notFound } from "next/navigation";
import Link from "next/link";

export const metadata = { title: "Dashboard — NDSC Fantasy" };

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const session = await requireSession();

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const fantasyUser = await db.fantasyUser.findUnique({
    where: { memberUserId: session.memberUserId },
  });

  const fantasyTeam = fantasyUser
    ? await db.fantasyTeam.findUnique({
        where: { fantasyUserId_leagueId: { fantasyUserId: fantasyUser.id, leagueId } },
        include: { roster: true },
      })
    : null;

  const pool = getMainDb();

  // Processed game IDs for this league
  const processedGames = await db.fantasyProcessedGame.findMany({
    where: { leagueId },
    select: { id: true },
    orderBy: { processedAt: "desc" },
  });
  const processedGameIds = processedGames.map((g) => g.id);

  // Top scorers across all pushed games in this league
  const topScorers = processedGameIds.length > 0
    ? await db.fantasyScore.groupBy({
        by: ["playerId"],
        where: { processedGameId: { in: processedGameIds } },
        _sum: { fantasyPoints: true },
        orderBy: { _sum: { fantasyPoints: "desc" } },
        take: 5,
      })
    : [];

  const topScorerIds = topScorers.map((s) => s.playerId);
  let topPlayers: { id: string; display_name: string }[] = [];
  if (topScorerIds.length > 0) {
    const pRes = await pool.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])",
      [topScorerIds]
    );
    topPlayers = pRes.rows;
  }

  const topPlayersWithPoints = topScorers.map((s) => ({
    name: topPlayers.find((p) => p.id === s.playerId)?.display_name ?? "Unknown",
    points: s._sum.fantasyPoints ?? 0,
  }));

  // Latest price changes for this league
  const priceChanges = processedGameIds.length > 0
    ? await db.fantasyPriceHistory.findMany({
        where: { processedGameId: { in: processedGameIds } },
        orderBy: { processedGame: { processedAt: "desc" } },
        take: 5,
      })
    : [];

  const priceChangePlayerIds = [...new Set(priceChanges.map((p) => p.playerId))];
  let priceChangePlayers: { id: string; display_name: string }[] = [];
  if (priceChangePlayerIds.length > 0) {
    const pcRes = await pool.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])",
      [priceChangePlayerIds]
    );
    priceChangePlayers = pcRes.rows;
  }

  const transfersUsed = fantasyTeam
    ? await db.fantasyTransfer.count({ where: { fantasyTeamId: fantasyTeam.id } })
    : 0;
  const freeTransfersLeft = Math.max(0, 1 - (transfersUsed % 1));

  const base = `/league/${leagueId}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{league.name}</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {processedGames.length > 0
            ? `${processedGames.length} game${processedGames.length !== 1 ? "s" : ""} processed`
            : "No games processed yet"}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Budget"
          value={fantasyTeam ? `£${Number(fantasyTeam.currentBudget).toFixed(1)}M` : "—"}
          sub="remaining"
        />
        <StatCard
          label="Total Points"
          value={fantasyTeam ? fantasyTeam.totalPoints.toString() : "—"}
          sub="season total"
        />
        <StatCard
          label="Squad"
          value={fantasyTeam ? `${fantasyTeam.roster.length}/5` : "0/5"}
          sub="players"
        />
        <StatCard
          label="Free Transfers"
          value={freeTransfersLeft.toString()}
          sub="available"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">My Squad</h2>
            <Link href={`${base}/my-team`} className="text-xs text-ndsc-navy font-medium hover:underline">
              Manage →
            </Link>
          </div>
          {!fantasyTeam || fantasyTeam.roster.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-400 text-sm mb-3">No players selected yet</p>
              <Link
                href={`${base}/players`}
                className="inline-block rounded-lg bg-ndsc-navy text-white text-sm px-4 py-2 font-medium hover:bg-slate-700 transition-colors"
              >
                Browse Players
              </Link>
            </div>
          ) : (
            <p className="text-slate-500 text-sm">
              {fantasyTeam.roster.length} player{fantasyTeam.roster.length !== 1 ? "s" : ""} in your squad.
              Head to My Team to manage your lineup.
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-800 mb-4">Top Scorers</h2>
          {topPlayersWithPoints.length === 0 ? (
            <p className="text-slate-400 text-sm">No scores recorded yet.</p>
          ) : (
            <ol className="space-y-2">
              {topPlayersWithPoints.map((p, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-xs flex items-center justify-center font-medium">
                      {i + 1}
                    </span>
                    <span className="text-slate-700 font-medium">{p.name}</span>
                  </div>
                  <span className="font-bold text-ndsc-navy">{p.points} pts</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-800 mb-4">Latest Price Changes</h2>
          {priceChanges.length === 0 ? (
            <p className="text-slate-400 text-sm">No price changes yet.</p>
          ) : (
            <ul className="space-y-2">
              {priceChanges.map((c) => {
                const playerName = priceChangePlayers.find((p) => p.id === c.playerId)?.display_name ?? "Unknown";
                const rise = Number(c.changeAmount) > 0;
                return (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{playerName}</span>
                    <span className={`font-semibold ${rise ? "text-green-600" : "text-red-500"}`}>
                      {rise ? "+" : ""}£{Number(c.changeAmount).toFixed(1)}M
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="bg-gradient-to-br from-ndsc-navy to-slate-800 rounded-xl p-5 shadow-sm text-white">
          <h2 className="font-semibold mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <QuickLink href={`${base}/players`} label="Browse & sign players" />
            <QuickLink href={`${base}/my-team`} label="Set your captain" />
            <QuickLink href={`${base}/standings`} label="View league table" />
          </div>
        </div>
      </div>

      {/* Rules & incentives */}
      <details className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden group">
        <summary className="px-5 py-4 cursor-pointer flex items-center justify-between font-semibold text-slate-800 select-none hover:bg-slate-50 transition-colors">
          <span>Rules & Scoring Guide</span>
          <span className="text-slate-400 text-sm group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="px-5 pb-6 pt-2 space-y-6 text-sm text-slate-700 border-t border-slate-100">

          <RulesSection title="Squad">
            <Rule label="7 players" detail="Build a squad of exactly 7 players" />
            <Rule label="£50M budget" detail="Spend wisely — unspent budget doesn't carry over" />
            <Rule label="Max 2 per team" detail="No more than 2 players from the same NDSC team" />
          </RulesSection>

          <RulesSection title="Scoring — per game">
            <Rule label="Single" detail="+1 pt" />
            <Rule label="Double" detail="+2 pts" />
            <Rule label="Triple" detail="+3 pts" />
            <Rule label="Home run" detail="+5 pts" />
            <Rule label="RBI / Run scored / Walk" detail="+1 pt each" />
            <Rule label="Defensive out (unassisted or assisted)" detail="+1 pt each" />
            <Rule label="Win" detail="+3 pts &nbsp;·&nbsp; Draw +1 pt &nbsp;·&nbsp; Loss 0 pts" />
          </RulesSection>

          <RulesSection title="Multipliers & Bonuses">
            <Rule
              label="Captain (2×)"
              detail="Your captain scores double points for every game. Choose wisely each week from My Team."
              highlight
            />
            <Rule
              label="Rookie / Development player (2×)"
              detail="Any player with rookie or development squad status scores double points automatically. Look for the green ROOKIE badge."
              highlight
            />
            <Rule
              label="Women majority bonus (+3 pts / game)"
              detail="If more than half your squad (4+ of 7) are female players, your whole team earns +3 bonus points for every game pushed. Look for the pink F badge."
              highlight
            />
            <Rule
              label="Differential pick"
              detail="Players owned by fewer than 20% of managers show a purple DIFF badge. No point bonus — but a surprise big game from a differential can swing the standings."
            />
          </RulesSection>

          <RulesSection title="Transfers">
            <Rule label="1 free transfer per week" detail="The transfer window resets every Monday at midnight." />
            <Rule
              label="Extra transfers cost −15 pts"
              detail="You can make as many transfers as you like, but each one beyond the first this week deducts 15 points at the next game push."
            />
          </RulesSection>

          <RulesSection title="Prices">
            <Rule label="Set at season start" detail="Prices are calculated from last season's end-of-season stats using OPS, OBP, AVG, defensive outs, and availability." />
            <Rule label="Rise / fall each game" detail="A player who outperforms their rolling 5-game average rises up to +£2M. Underperformers fall up to −£2M." />
            <Rule label="Price range" detail="£0.5M minimum · £20M maximum" />
          </RulesSection>

        </div>
      </details>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-black text-ndsc-navy mt-1">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2.5 transition-colors text-sm font-medium"
    >
      <span>{label}</span>
      <span>→</span>
    </Link>
  );
}

function RulesSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-ndsc-navy mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Rule({ label, detail, highlight }: { label: string; detail: string; highlight?: boolean }) {
  return (
    <div className={`flex gap-3 rounded-lg px-3 py-2 ${highlight ? "bg-ndsc-gold/10 border border-ndsc-gold/30" : "bg-slate-50"}`}>
      <span className={`font-semibold whitespace-nowrap ${highlight ? "text-amber-700" : "text-slate-700"}`}>{label}</span>
      <span className="text-slate-500">{detail}</span>
    </div>
  );
}
