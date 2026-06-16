import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/lib/actions";
import Link from "next/link";
import { DeleteLeagueButton } from "./delete-league-button";

export const dynamic = 'force-dynamic';
export const metadata = { title: "Admin — NDSC Fantasy" };

const STATUS_COLOUR: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700",
  active: "bg-green-100 text-green-700",
  closed: "bg-slate-100 text-slate-500",
};

export default async function AdminPage() {
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

  const leagues = await db.fantasyLeague.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { teams: true, processedGames: true } } },
  });

  // Get all seasons from main DB for display
  const seasonsRes = await pool.query<{ id: string; year: number; is_active: boolean }>(
    "SELECT id, year, is_active FROM seasons ORDER BY year DESC"
  );
  const seasons = seasonsRes.rows;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-ndsc-navy shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/home" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-ndsc-gold flex items-center justify-center">
                <span className="text-sm font-black text-ndsc-navy">N</span>
              </div>
              <span className="text-white font-bold text-lg hidden sm:block">NDSC Fantasy Admin</span>
            </Link>
            <div className="flex items-center gap-4">
              <span className="text-slate-400 text-sm hidden md:block">
                {user?.display_name ?? user?.email}
              </span>
              <form action={logoutAction}>
                <button type="submit" className="text-slate-400 hover:text-white text-sm transition-colors">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Leagues</h1>
            <p className="text-slate-500 text-sm mt-0.5">Create and manage fantasy league seasons</p>
          </div>
          <Link
            href="/admin/leagues/new"
            className="rounded-lg bg-ndsc-navy text-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-700 transition-colors"
          >
            + New League
          </Link>
        </div>

        {leagues.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center shadow-sm">
            <p className="text-slate-400 text-lg mb-2">No leagues yet</p>
            <p className="text-slate-400 text-sm">Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leagues.map((league) => {
              const season = seasons.find((s) => s.id === league.mainSeasonId);
              return (
                <div
                  key={league.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="font-semibold text-slate-900 truncate">{league.name}</h2>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOUR[league.status] ?? STATUS_COLOUR.draft}`}>
                        {league.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">
                      Season {season?.year ?? league.mainSeasonId.slice(0, 8)} ·{" "}
                      {league._count.teams} managers · {league._count.processedGames} games pushed
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Link
                      href={`/admin/leagues/${league.id}`}
                      className="rounded-lg border border-slate-300 text-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors"
                    >
                      Manage →
                    </Link>
                    <DeleteLeagueButton leagueId={league.id} leagueName={league.name} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
