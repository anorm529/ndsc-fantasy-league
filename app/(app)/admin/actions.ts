"use server";

import { db } from "@/app/lib/fantasy-db";
import { requireSession } from "@/app/lib/auth";
import { getMainDb } from "@/app/lib/main-db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

async function assertAdmin(memberUserId: string) {
  const pool = getMainDb();
  const res = await pool.query<{ role: string }>(
    "SELECT role FROM users WHERE id = $1",
    [memberUserId]
  );
  const role = res.rows[0]?.role;
  if (role !== "owner" && role !== "admin") redirect("/home");
}

export async function deleteLeagueAction(leagueId: string) {
  const session = await requireSession();
  await assertAdmin(session.memberUserId);

  await db.fantasyLeague.delete({ where: { id: leagueId } });

  revalidatePath("/admin");
  revalidatePath("/home");
  redirect("/admin");
}
