import Link from "next/link";

const links = [
  { href: "/", label: "Overview" },
  { href: "/chaos", label: "Chaos" },
  { href: "/incidents", label: "Incidents" },
  { href: "/review", label: "Review queue" },
  { href: "/ops", label: "Ops" },
];

export function Sidebar() {
  return (
    <aside className="flex w-full shrink-0 flex-row gap-2 overflow-x-auto border-b border-(--line) bg-(--sidebar) px-3 py-3 md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-4 md:py-6">
      <div className="mb-0 mr-3 md:mb-6 md:mr-0">
        <div className="text-xs uppercase tracking-[0.18em] text-(--muted)">
          Relay
        </div>
        <div className="text-sm font-semibold text-(--accent)">
          Incident Agent
        </div>
      </div>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-lg px-3 py-2 text-sm text-(--muted) hover:bg-(--panel) hover:text-foreground"
        >
          {l.label}
        </Link>
      ))}
    </aside>
  );
}
