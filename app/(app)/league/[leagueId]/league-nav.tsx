"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/lib/actions";
import { clsx } from "clsx";

type Props = {
  leagueId: string;
  leagueName: string;
  displayName: string;
  role: string;
};

export function LeagueNav({ leagueId, leagueName, displayName, role }: Props) {
  const pathname = usePathname();
  const base = `/league/${leagueId}`;

  const links = [
    { href: `${base}/dashboard`, label: "Home" },
    { href: `${base}/my-team`, label: "Squad" },
    { href: `${base}/players`, label: "Players" },
    { href: `${base}/market`, label: "Market" },
    { href: `${base}/transfers`, label: "Transfers" },
    { href: `${base}/standings`, label: "Table" },
    { href: `${base}/awards`, label: "Awards" },
  ];

  return (
    <header className="bg-ndsc-navy shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand — clicking goes back to league selection */}
          <Link href="/home" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-full bg-ndsc-gold flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-black text-ndsc-navy">N</span>
            </div>
            <div className="hidden sm:block">
              <p className="text-white font-bold text-sm leading-none">NDSC Fantasy</p>
              <p className="text-slate-400 text-xs leading-none mt-0.5 group-hover:text-ndsc-gold transition-colors truncate max-w-40">
                {leagueName}
              </p>
            </div>
          </Link>

          {/* Nav links */}
          <nav className="flex items-center gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={clsx(
                  "px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                  pathname.startsWith(l.href)
                    ? "bg-white/15 text-white"
                    : "text-slate-300 hover:text-white hover:bg-white/10"
                )}
              >
                {l.label}
              </Link>
            ))}
            {(role === "owner" || role === "admin") && (
              <Link
                href={`/admin/leagues/${leagueId}`}
                className={clsx(
                  "px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                  pathname.startsWith(`/admin/leagues/${leagueId}`)
                    ? "bg-ndsc-gold/20 text-ndsc-gold"
                    : "text-ndsc-gold/70 hover:text-ndsc-gold hover:bg-ndsc-gold/10"
                )}
              >
                Admin
              </Link>
            )}
          </nav>

          {/* User + logout */}
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm hidden md:block">{displayName}</span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="text-slate-400 hover:text-white text-sm transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
