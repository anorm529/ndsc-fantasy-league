"use client";

import { useTransition, useState } from "react";
import { archiveAndCloseLeagueAction } from "./actions";

export function ArchiveLeagueButton({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ deleted?: Record<string, number>; error?: string } | null>(null);

  const handleClick = () => {
    if (!confirm(
      `Archive and close "${leagueName}"?\n\n` +
      `This will:\n` +
      `• Save a final standings snapshot to the audit log\n` +
      `• Delete all rosters, transfers, scores, price history, and player prices\n` +
      `• Keep the league record, team standings, and gameweek dates\n\n` +
      `The season cannot be reopened after archiving.`
    )) return;
    if (!confirm(`Second confirmation: archive and close "${leagueName}"?`)) return;

    startTransition(async () => {
      const r = await archiveAndCloseLeagueAction(leagueId);
      setResult(r);
    });
  };

  if (result?.deleted && !pending) {
    const d = result.deleted;
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
        Season archived and closed.{" "}
        Removed: {d.rosters} roster entries · {d.scores} scores · {d.priceHistory} price records · {d.playerMeta} player prices · {d.transfers} transfers.
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="rounded-lg bg-amber-600 text-white px-4 py-2 text-sm font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50"
    >
      {pending ? "Archiving…" : "Archive & Close Season"}
    </button>
  );
}
