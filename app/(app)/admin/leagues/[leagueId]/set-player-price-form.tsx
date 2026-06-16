"use client";

import { useTransition, useState } from "react";
import { setPlayerPriceAction } from "./actions";

type Player = { id: string; display_name: string; gender: string | null };
type MetaMap = Record<string, { currentPrice: number; fantasyRating: number }>;

export function SetPlayerPriceForm({
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
  const meta = metaMap[selectedId];

  return (
    <form
      action={(fd) => startTransition(() => setPlayerPriceAction(leagueId, fd))}
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Price (£M)</label>
          <input
            name="price"
            type="number"
            step="0.5"
            min="0.5"
            max="20"
            defaultValue={meta?.currentPrice ?? 3.0}
            key={`price-${selectedId}`}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Rating (0–100)</label>
          <input
            name="rating"
            type="number"
            min="0"
            max="100"
            defaultValue={meta?.fantasyRating ?? 50}
            key={`rating-${selectedId}`}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ndsc-navy/20"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending || !selectedId}
        className="w-full rounded-lg bg-ndsc-navy text-white text-sm py-2 font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
      >
        {pending ? "Saving…" : "Override Price"}
      </button>
    </form>
  );
}
