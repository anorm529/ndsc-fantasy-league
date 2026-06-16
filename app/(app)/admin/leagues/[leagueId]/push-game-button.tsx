"use client";

import { useTransition, useState } from "react";
import { pushGameAction } from "./actions";

export function PushGameButton({
  gameId,
  leagueId,
  label,
  alreadyPushed,
}: {
  gameId: string;
  leagueId: string;
  label: string;
  alreadyPushed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ scoreCount?: number; priceChanges?: number; error?: string } | null>(null);

  const handleClick = () => {
    const verb = alreadyPushed ? "Re-push" : "Push";
    if (!confirm(`${verb} stats for ${label} to fantasy?\n\n${alreadyPushed ? "Existing scores for this game will be recalculated." : "Player fantasy points and prices will be updated."}`)) return;
    startTransition(async () => {
      const r = await pushGameAction(gameId, leagueId);
      setResult(r);
    });
  };

  if (result && !pending) {
    if (result.error) {
      return <span className="text-xs text-red-600 font-medium">{result.error}</span>;
    }
    return (
      <span className="text-xs text-green-600 font-medium">
        ✓ {result.scoreCount} scores · {result.priceChanges} price changes
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
        alreadyPushed
          ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
          : "bg-ndsc-navy text-white hover:bg-slate-700"
      }`}
    >
      {pending ? "Pushing…" : alreadyPushed ? "Re-push" : "Push to Fantasy"}
    </button>
  );
}
