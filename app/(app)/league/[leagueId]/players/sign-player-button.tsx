"use client";

import { useTransition } from "react";
import { signPlayerAction, transferPlayerAction } from "./actions";

export function SignPlayerButton({
  playerId,
  playerName,
  price,
  disabled,
  disabledReason,
  teamId,
  leagueId,
  replacingRosterId,
  replacingPlayerName,
}: {
  playerId: string;
  playerName: string;
  price: number;
  disabled: boolean;
  disabledReason?: string;
  teamId?: string;
  leagueId: string;
  replacingRosterId?: string;
  replacingPlayerName?: string;
}) {
  const [pending, startTransition] = useTransition();
  const isTransfer = !!replacingRosterId;

  const handleClick = () => {
    if (!teamId) return;
    const msg = isTransfer
      ? `Transfer out ${replacingPlayerName} and sign ${playerName} for £${price.toFixed(1)}M?`
      : `Sign ${playerName} for £${price.toFixed(1)}M?`;
    if (!confirm(msg)) return;
    startTransition(async () => {
      if (isTransfer && replacingRosterId) {
        await transferPlayerAction(teamId, replacingRosterId, playerId, price, leagueId);
      } else {
        await signPlayerAction(teamId, playerId, price, leagueId);
      }
    });
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || pending || !teamId}
      title={disabledReason}
      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        isTransfer
          ? "bg-amber-500 text-white hover:bg-amber-600"
          : "bg-ndsc-navy text-white hover:bg-slate-700"
      }`}
    >
      {pending ? (isTransfer ? "Transferring…" : "Signing…") : isTransfer ? "Transfer" : "Sign"}
    </button>
  );
}
