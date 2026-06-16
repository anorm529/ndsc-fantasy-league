"use client";

import { useTransition, useState } from "react";
import { generateAwardsAction } from "./actions";

export function GenerateAwardsButton({ leagueId }: { leagueId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; count?: number } | null>(null);

  const handleClick = () => {
    if (!confirm("Generate / regenerate all season awards? This will overwrite any previously generated awards.")) return;
    startTransition(async () => {
      const r = await generateAwardsAction(leagueId);
      setResult(r);
    });
  };

  if (result && !pending) {
    if (result.error) return <span className="text-xs text-red-600 font-medium">{result.error}</span>;
    return <span className="text-xs text-green-600 font-medium">✓ {result.count} awards generated</span>;
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="text-sm rounded-lg bg-ndsc-gold text-ndsc-navy px-4 py-2 font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50"
    >
      {pending ? "Generating…" : "Generate Awards"}
    </button>
  );
}
