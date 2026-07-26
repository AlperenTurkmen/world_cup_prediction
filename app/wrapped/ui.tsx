import type { ReactNode } from "react";

/** A titled page section with generous vertical rhythm. */
export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-14">
      <h2 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
      {subtitle && <p className="mt-1 text-sm opacity-60">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A bordered card. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-black/10 bg-black/[0.015] p-4 dark:border-white/15 dark:bg-white/[0.02] ${className}`}>
      {children}
    </div>
  );
}

/** A small labeled stat. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide opacity-50">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">{value}</div>
      {hint && <div className="text-xs opacity-50">{hint}</div>}
    </div>
  );
}

/** A horizontal stacked bar for the group/ranking/knockout split. */
export function BreakdownBar({
  group,
  ranking,
  knockout,
  max,
}: {
  group: number;
  ranking: number;
  knockout: number;
  max: number;
}) {
  const pct = (v: number) => `${(100 * v) / max}%`;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
      <div style={{ width: pct(group) }} className="bg-indigo-500" title={`Group ${group}`} />
      <div style={{ width: pct(ranking) }} className="bg-emerald-500" title={`Ranking ${ranking}`} />
      <div style={{ width: pct(knockout) }} className="bg-amber-500" title={`Knockout ${knockout}`} />
    </div>
  );
}

/** A rounded chip. */
export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15 ${className}`}>
      {children}
    </span>
  );
}

/** Compact scoreline "2–1". */
export function Score({ h, a }: { h: number; a: number }) {
  return (
    <span className="font-bold tabular-nums">
      {h}
      <span className="opacity-40">–</span>
      {a}
    </span>
  );
}
