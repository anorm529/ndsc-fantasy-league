"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/app/lib/fantasy-db";
import { requireSession } from "@/app/lib/auth";

export async function requestJoinAction(
  leagueId: string,
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const session = await requireSession();
  const teamName = formData.get("team_name")?.toString().trim() ?? "";

  if (teamName.length < 2 || teamName.length > 50) {
    return { error: "Team name must be 2–50 characters." };
  }

  const league = await db.fantasyLeague.findUnique({ where: { id: leagueId } });
  if (!league || league.status === "closed") {
    return { error: "This league is no longer accepting requests." };
  }
  if (!league.joinRequestsOpen) {
    return { error: "Join requests are currently closed for this league." };
  }

  const fantasyUser = await db.fantasyUser.findUnique({
    where: { memberUserId: session.memberUserId },
  });
  if (fantasyUser) {
    const existing = await db.fantasyTeam.findUnique({
      where: { fantasyUserId_leagueId: { fantasyUserId: fantasyUser.id, leagueId } },
    });
    if (existing) return { error: "You already have a team in this league." };
  }

  await db.fantasyJoinRequest.upsert({
    where: { leagueId_memberUserId: { leagueId, memberUserId: session.memberUserId } },
    create: { leagueId, memberUserId: session.memberUserId, teamName, status: "pending" },
    update: { teamName, status: "pending" },
  });

  revalidatePath("/home");
  return { ok: true };
}
