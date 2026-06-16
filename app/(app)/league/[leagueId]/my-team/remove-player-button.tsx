"use client";

import { removePlayerAction } from "./actions";
import { useTransition } from "react";

export function RemovePlayerButton({
  teamId,
  rosterId,
  leagueId,
}: {
  teamId: string;
  rosterId: string;
  leagueId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => {
        if (!confirm("Remove this player from your squad?")) return;
        startTransition(() => removePlayerAction(teamId, rosterId, leagueId));
      }}
      disabled={pending}
      className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
    >
      {pending ? "…" : "Remove"}
    </button>
  );
}
