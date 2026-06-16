"use client";

import { useActionState } from "react";
import { requestJoinAction } from "./actions";

type Props = {
  leagueId: string;
  requestsOpen: boolean;
};

const initial: { error?: string; ok?: boolean } = {};

export function JoinRequestForm({ leagueId, requestsOpen }: Props) {
  const action = requestJoinAction.bind(null, leagueId);
  const [state, formAction, pending] = useActionState(action, initial);

  if (state.ok) {
    return (
      <p className="text-sm text-ndsc-green font-medium">
        Request sent — waiting for admin approval.
      </p>
    );
  }

  if (!requestsOpen) {
    return (
      <p className="text-sm text-slate-400 italic">Applications are currently closed.</p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      {state.error && (
        <p className="text-xs text-red-600">{state.error}</p>
      )}
      <input
        name="team_name"
        type="text"
        placeholder="Your team name…"
        maxLength={50}
        required
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-ndsc-navy text-white text-sm font-semibold py-2 hover:bg-slate-700 transition-colors disabled:opacity-50"
      >
        {pending ? "Sending…" : "Request to Join"}
      </button>
    </form>
  );
}
