"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/app/lib/fantasy-db";
import { requireSession } from "@/app/lib/auth";

export async function setCaptainAction(teamId: string, rosterId: string, leagueId: string) {
  await requireSession();

  await db.$transaction([
    db.fantasyRoster.updateMany({
      where: { fantasyTeamId: teamId },
      data: { isCaptain: false },
    }),
    db.fantasyRoster.update({
      where: { id: rosterId },
      data: { isCaptain: true },
    }),
  ]);

  revalidatePath(`/league/${leagueId}/my-team`);
}

export async function removePlayerAction(teamId: string, rosterId: string, leagueId: string) {
  await requireSession();

  const roster = await db.fantasyRoster.findUnique({ where: { id: rosterId } });
  if (!roster || roster.fantasyTeamId !== teamId) return;

  const team = await db.fantasyTeam.findUnique({ where: { id: teamId } });
  if (!team) return;

  await db.$transaction([
    db.fantasyRoster.delete({ where: { id: rosterId } }),
    db.fantasyTeam.update({
      where: { id: teamId },
      data: { currentBudget: { increment: roster.currentPrice } },
    }),
  ]);

  revalidatePath(`/league/${leagueId}/my-team`);
}
