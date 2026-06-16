"use client";

import { useTransition } from "react";
import { signPlayerAction } from "./actions";

export function SignPlayerButton({
  playerId,
  playerName,
  price,
  disabled,
  disabledReason,
  teamId,
  leagueId,
}: {
  playerId: string;
  playerName: string;
  price: number;
  disabled: boolean;
  disabledReason?: string;
  teamId?: string;
  leagueId: string;
}) {
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    if (!teamId) return;
    if (!confirm(`Sign ${playerName} for £${price.toFixed(1)}M?`)) return;
    startTransition(async () => {
      await signPlayerAction(teamId, playerId, price, leagueId);
    });
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || pending || !teamId}
      title={disabledReason}
      className="text-xs px-3 py-1.5 rounded-lg bg-ndsc-navy text-white font-medium hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {pending ? "Signing…" : "Sign"}
    </button>
  );
}
