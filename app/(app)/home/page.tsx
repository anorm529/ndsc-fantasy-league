import Image from "next/image";
import { requireSession } from "@/app/lib/auth";
import { db } from "@/app/lib/fantasy-db";
import { getMainDb } from "@/app/lib/main-db";
import { logoutAction } from "@/app/lib/actions";
import Link from "next/link";
import { JoinRequestForm } from "./join-request-form";

export const dynamic = 'force-dynamic';
export const metadata = { title: "NDSC Fantasy — Select League" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Coming Soon",
  active: "Active",
  closed: "Finished",
};

const STATUS_COLOUR: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700",
  active: "bg-green-100 text-green-700",
  closed: "bg-slate-100 text-slate-500",
};

export default async function HomePage() {
  const session = await requireSession();
  const pool = getMainDb();

  const userRes = await pool.query<{ display_name: string; role: string; email: string }>(
    `SELECT p.display_name, u.role, u.email
     FROM users u
     LEFT JOIN players p ON p.id = u.player_id
     WHERE u.id = $1`,
    [session.memberUserId]
  );
  const user = userRes.rows[0];
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  const leagues = await db.fantasyLeague.findMany({
    where: { status: { not: "draft" } },
    orderBy: { createdAt: "desc" },
  });

  const fantasyUser = await db.fantasyUser.findUnique({
    where: { memberUserId: session.memberUserId },
    include: { teams: true },
  });
  const teamsByLeague = new Map(
    (fantasyUser?.teams ?? []).map((t) => [t.leagueId, t])
  );

  // Load this user's join requests across all leagues
  const joinRequests = await db.fantasyJoinRequest.findMany({
    where: { memberUserId: session.memberUserId },
  });
  const requestsByLeague = new Map(joinRequests.map((r) => [r.leagueId, r]));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-ndsc-navy shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <Image
                src="/fantasy-logo.png"
                alt="NDSC Fantasy"
                width={36}
                height={36}
                className="flex-shrink-0"
              />
              <span className="text-white font-bold text-lg leading-none hidden sm:block">
                NDSC Fantasy
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-slate-400 text-sm hidden md:block">
                {user?.display_name ?? user?.email}
              </span>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="text-ndsc-gold/80 hover:text-ndsc-gold text-sm font-medium transition-colors"
                >
                  Admin
                </Link>
              )}
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="text-slate-400 hover:text-white text-sm transition-colors"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-slate-900">Select a League</h1>
          <p className="text-slate-500 mt-1">
            Choose a season to manage your fantasy team.
          </p>
        </div>

        {leagues.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center shadow-sm">
            <p className="text-slate-400 text-lg mb-2">No leagues available yet</p>
            {isAdmin && (
              <Link
                href="/admin/leagues/new"
                className="inline-block mt-4 rounded-lg bg-ndsc-navy text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-700 transition-colors"
              >
                Create First League
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {leagues.map((league) => {
              const myTeam = teamsByLeague.get(league.id);
              const joinRequest = requestsByLeague.get(league.id);
              const isClosed = league.status === "closed";

              // User has a team — standard linked card
              if (myTeam) {
                return (
                  <Link
                    key={league.id}
                    href={`/league/${league.id}/dashboard`}
                    className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-ndsc-navy/30 transition-all p-6 flex flex-col gap-4"
                  >
                    <CardHeader league={league} />
                    <div className="flex gap-6 text-sm">
                      <Stat label="Points" value={String(myTeam.totalPoints)} />
                      <Stat
                        label="Rank"
                        value={myTeam.overallRank != null ? `#${myTeam.overallRank}` : "—"}
                      />
                      <Stat
                        label="Budget"
                        value={`£${Number(myTeam.currentBudget).toFixed(1)}M`}
                      />
                    </div>
                    {myTeam.teamName && (
                      <p className="text-xs text-slate-400 -mt-2">{myTeam.teamName}</p>
                    )}
                  </Link>
                );
              }

              // Closed league the user never joined — show info only
              if (isClosed) {
                return (
                  <div
                    key={league.id}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4 opacity-60"
                  >
                    <CardHeader league={league} />
                    <p className="text-sm text-slate-400">You did not participate in this season.</p>
                  </div>
                );
              }

              // Active league — show request state
              return (
                <div
                  key={league.id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4"
                >
                  <CardHeader league={league} />

                  {joinRequest?.status === "pending" && (
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-amber-700">
                        Request pending approval
                      </p>
                      <p className="text-xs text-slate-400">
                        Team name: <span className="font-medium text-slate-600">{joinRequest.teamName}</span>
                      </p>
                      <p className="text-xs text-slate-400">
                        The league admin will review your request.
                      </p>
                    </div>
                  )}

                  {joinRequest?.status === "approved" && (
                    <p className="text-sm text-ndsc-green font-medium">
                      Approved — check back soon or contact the admin.
                    </p>
                  )}

                  {(joinRequest?.status === "rejected" || !joinRequest) && (
                    <div className="space-y-2">
                      {joinRequest?.status === "rejected" && (
                        <p className="text-xs text-red-600 font-medium">
                          Your previous request was not approved. You can request again below.
                        </p>
                      )}
                      <JoinRequestForm
                        leagueId={league.id}
                        requestsOpen={league.joinRequestsOpen}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function CardHeader({
  league,
}: {
  league: { name: string; status: string };
}) {
  return (
    <div className="flex items-start justify-between">
      <h2 className="text-lg font-bold text-slate-900">{league.name}</h2>
      <span
        className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${STATUS_COLOUR[league.status] ?? STATUS_COLOUR.draft}`}
      >
        {STATUS_LABEL[league.status] ?? league.status}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-400 text-xs font-medium">{label}</p>
      <p className="text-xl font-black text-ndsc-navy">{value}</p>
    </div>
  );
}
