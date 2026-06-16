"use client";

import { setCaptainAction } from "./actions";
import { useTransition } from "react";

export function SetCaptainButton({
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
      onClick={() => startTransition(() => setCaptainAction(teamId, rosterId, leagueId))}
      disabled={pending}
      className="text-xs text-ndsc-navy border border-ndsc-navy/30 hover:bg-ndsc-navy hover:text-white rounded px-2 py-1 transition-colors disabled:opacity-50"
    >
      {pending ? "…" : "Make Captain"}
    </button>
  );
}
