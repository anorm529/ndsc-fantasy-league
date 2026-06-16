import { requireSession } from "@/app/lib/auth";
import { getMainDb } from "@/app/lib/main-db";
import { redirect } from "next/navigation";
import { createLeagueAction } from "./actions";
import Link from "next/link";

export const metadata = { title: "New League — NDSC Fantasy Admin" };

export default async function NewLeaguePage() {
  const session = await requireSession();
  const pool = getMainDb();

  const userRes = await pool.query<{ role: string }>(
    "SELECT role FROM users WHERE id = $1",
    [session.memberUserId]
  );
  if (userRes.rows[0]?.role !== "owner" && userRes.rows[0]?.role !== "admin") {
    redirect("/home");
  }

  const seasonsRes = await pool.query<{ id: string; year: number; is_active: boolean }>(
    "SELECT id, year, is_active FROM seasons ORDER BY year DESC"
  );
  const seasons = seasonsRes.rows;

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-700">
            ← Back to leagues
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <h1 className="text-xl font-bold text-slate-900 mb-1">Create New League</h1>
          <p className="text-slate-500 text-sm mb-6">
            Set up a new fantasy league season. Prices can be generated once created.
          </p>

          <form action={createLeagueAction} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                League Name
              </label>
              <input
                name="name"
                required
                placeholder="e.g. NDSC Fantasy 2026"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Main Season
              </label>
              <p className="text-xs text-slate-400 mb-2">
                The active season whose game stats will be used for scoring.
              </p>
              <select
                name="main_season_id"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
              >
                <option value="">Select season…</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.year}{s.is_active ? " (active)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Price Base Season <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <p className="text-xs text-slate-400 mb-2">
                If set, the "Generate Prices" button will use end-of-season stats from this
                season with a 25% regression to mean. Leave blank to use current-season
                live stats instead.
              </p>
              <select
                name="prev_season_id"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
              >
                <option value="">None — use live stats</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.year} end-of-season
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                name="status"
                defaultValue="draft"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
              >
                <option value="draft">Draft — not visible to players</option>
                <option value="active">Active — open for signups</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-ndsc-navy text-white py-2.5 text-sm font-bold hover:bg-slate-700 transition-colors"
            >
              Create League
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
