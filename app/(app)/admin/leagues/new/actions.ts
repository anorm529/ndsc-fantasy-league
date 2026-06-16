"use server";

import { db } from "@/app/lib/fantasy-db";
import { requireSession } from "@/app/lib/auth";
import { getMainDb } from "@/app/lib/main-db";
import { redirect } from "next/navigation";

export async function createLeagueAction(formData: FormData) {
  const session = await requireSession();
  const pool = getMainDb();

  const userRes = await pool.query<{ role: string }>(
    "SELECT role FROM users WHERE id = $1",
    [session.memberUserId]
  );
  const role = userRes.rows[0]?.role;
  if (role !== "owner" && role !== "admin") redirect("/home");

  const name = formData.get("name")?.toString().trim();
  const mainSeasonId = formData.get("main_season_id")?.toString();
  const prevSeasonId = formData.get("prev_season_id")?.toString() || null;
  const status = formData.get("status")?.toString() ?? "draft";

  if (!name || !mainSeasonId) return;

  const league = await db.fantasyLeague.create({
    data: { name, mainSeasonId, prevSeasonId, status },
  });

  await db.fantasyAuditLog.create({
    data: {
      adminUserId: session.memberUserId,
      leagueId: league.id,
      action: "create_league",
      targetType: "league",
      targetId: league.id,
      details: `Created league "${name}"`,
    },
  });

  redirect(`/admin/leagues/${league.id}`);
}
