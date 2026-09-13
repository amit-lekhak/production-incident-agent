"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview", match: "exact" as const },
  { href: "/chaos", label: "Chaos", match: "prefix" as const },
  { href: "/incidents", label: "Incidents", match: "prefix" as const },
  { href: "/review", label: "Review", match: "prefix" as const },
  { href: "/prs", label: "PRs", match: "prefix" as const },
  { href: "/ops", label: "Ops", match: "prefix" as const },
];

function isActive(pathname: string, href: string, match: "exact" | "prefix") {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-full shrink-0 flex-row gap-2 overflow-x-auto border-b border-(--line) bg-(--sidebar) px-3 py-3 md:h-full md:w-56 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:px-4 md:py-6">
      <div className="mb-0 mr-3 shrink-0 md:mb-6 md:mr-0">
        <div className="text-sm font-semibold tracking-tight text-(--accent)">
          Relay Incident
        </div>
        <div className="mt-0.5 text-xs text-(--muted)">Checkout IR console</div>
      </div>
      <nav className="flex flex-row gap-1 md:flex-col md:gap-0.5">
        {links.map((l) => {
          const active = isActive(pathname, l.href, l.match);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-lg bg-(--panel) px-3 py-2 text-sm font-medium text-foreground ring-1 ring-(--line) md:ring-0 md:border-l-2 md:border-(--accent) md:pl-[10px]"
                  : "rounded-lg px-3 py-2 text-sm text-(--muted) hover:bg-(--panel) hover:text-foreground md:border-l-2 md:border-transparent md:pl-[10px]"
              }
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
