export default function LeagueLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-1">
        <div className="h-7 bg-slate-200 rounded-lg w-48" />
        <div className="h-4 bg-slate-100 rounded w-36" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 h-24" />
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="h-5 bg-slate-200 rounded w-32" />
        </div>
        <div className="divide-y divide-slate-100">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 bg-slate-200 rounded w-40" />
                <div className="h-3 bg-slate-100 rounded w-24" />
              </div>
              <div className="h-4 bg-slate-100 rounded w-16" />
              <div className="h-4 bg-slate-100 rounded w-12" />
              <div className="h-7 bg-slate-100 rounded-lg w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
