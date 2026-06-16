import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { notFound } from "next/navigation";
import { LeagueNav } from "./league-nav";

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const session = await requireSession();

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const pool = getMainDb();
  const userRes = await pool.query<{ display_name: string; role: string; email: string }>(
    `SELECT p.display_name, u.role, u.email
     FROM users u
     LEFT JOIN players p ON p.id = u.player_id
     WHERE u.id = $1`,
    [session.memberUserId]
  );
  const user = userRes.rows[0];

  return (
    <div className="min-h-screen flex flex-col">
      <LeagueNav
        leagueId={leagueId}
        leagueName={league.name}
        displayName={user?.display_name ?? user?.email ?? "Member"}
        role={user?.role ?? "member"}
      />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        NDSC Fantasy Softball League &copy; 2026
      </footer>
    </div>
  );
}
