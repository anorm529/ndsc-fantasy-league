"use client";

import { useTransition } from "react";
import { deleteLeagueAction } from "./actions";

export function DeleteLeagueButton({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => {
        if (!confirm(`Permanently delete "${leagueName}"?\n\nThis will remove ALL teams, rosters, scores, price history, and audit logs for this league. This cannot be undone.`)) return;
        if (!confirm(`Second confirmation: delete "${leagueName}" and all its data?`)) return;
        startTransition(() => deleteLeagueAction(leagueId));
      }}
      disabled={pending}
      className="flex-shrink-0 rounded-lg border border-red-200 text-red-600 px-4 py-2 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
