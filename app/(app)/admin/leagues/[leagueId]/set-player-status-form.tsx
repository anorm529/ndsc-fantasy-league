"use client";

import { useTransition, useState } from "react";
import { setPlayerStatusAction } from "./actions";

type Player = { id: string; display_name: string; gender: string | null };
type MetaMap = Record<string, { status: string }>;

const STATUSES = ["active", "injured", "holiday", "work", "personal_leave"];

export function SetPlayerStatusForm({
  leagueId,
  players,
  metaMap,
}: {
  leagueId: string;
  players: Player[];
  metaMap: MetaMap;
}) {
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState("");
  const currentStatus = metaMap[selectedId]?.status ?? "active";

  return (
    <form
      action={(fd) => startTransition(() => setPlayerStatusAction(leagueId, fd))}
      className="space-y-3"
    >
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Player</label>
        <select
          name="player_id"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
        >
          <option value="">Select player…</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>{p.display_name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
        <select
          name="status"
          defaultValue={currentStatus}
          key={`status-${selectedId}`}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase())}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending || !selectedId}
        className="w-full rounded-lg border border-slate-300 text-slate-700 text-sm py-2 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        {pending ? "Saving…" : "Update Status"}
      </button>
    </form>
  );
}
