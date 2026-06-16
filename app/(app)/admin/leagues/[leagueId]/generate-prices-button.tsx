"use client";

import { useTransition, useState } from "react";
import { generatePricesAction } from "./actions";

export function GeneratePricesButton({ leagueId, hasPrevSeason }: { leagueId: string; hasPrevSeason: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ count?: number; error?: string } | null>(null);

  const handleClick = () => {
    const method = hasPrevSeason ? "previous season end-of-season stats (with regression to mean)" : "current season live stats";
    if (!confirm(`Generate prices using ${method}?\n\nThis will overwrite all existing prices for this league.`)) return;
    startTransition(async () => {
      const r = await generatePricesAction(leagueId);
      setResult(r);
    });
  };

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <button
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg bg-ndsc-gold text-ndsc-navy px-5 py-2.5 text-sm font-bold hover:bg-yellow-400 transition-colors disabled:opacity-50 shadow-sm"
      >
        {pending ? "Generating…" : "Generate Player Prices"}
      </button>
      {result && !pending && (
        <span className={`text-sm font-medium ${result.error ? "text-red-600" : "text-green-600"}`}>
          {result.error ?? `✓ Priced ${result.count} players`}
        </span>
      )}
    </div>
  );
}
