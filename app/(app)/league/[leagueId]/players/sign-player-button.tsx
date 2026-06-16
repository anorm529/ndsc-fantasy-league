"use client";

import { useState, useTransition } from "react";
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
  isExtraTransfer,
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
  isExtraTransfer?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [postWarning, setPostWarning] = useState<string | null>(null);
  const isTransfer = !!replacingRosterId;

  const handleClick = () => {
    if (!teamId) return;

    let msg = isTransfer
      ? `Transfer out ${replacingPlayerName} and sign ${playerName} for £${price.toFixed(1)}M?`
      : `Sign ${playerName} for £${price.toFixed(1)}M?`;

    if (isTransfer && isExtraTransfer) {
      msg += "\n\n⚠️ You've already used your free transfer this week.\nThis will cost −15 points at the next game push.";
    }

    if (!confirm(msg)) return;

    setPostWarning(null);
    startTransition(async () => {
      if (isTransfer && replacingRosterId) {
        const result = await transferPlayerAction(teamId, replacingRosterId, playerId, price, leagueId);
        if (result.warning) setPostWarning(result.warning);
      } else {
        await signPlayerAction(teamId, playerId, price, leagueId);
      }
    });
  };

  if (postWarning) {
    return (
      <span className="text-xs text-amber-600 font-medium">{postWarning}</span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
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
      {isTransfer && isExtraTransfer && !pending && (
        <span className="text-xs text-red-500 font-medium">−15 pts</span>
      )}
    </div>
  );
}
