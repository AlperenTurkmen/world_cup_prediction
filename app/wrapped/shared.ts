import raw from "@/lib/wrappedData.json";
import type { WrappedData, UserWrapped } from "@/lib/wrapped";

/** The precomputed, frozen Wrapped dataset (built by scripts/buildWrapped.ts). */
export const wrapped = raw as unknown as WrappedData;

export function userBySlug(slug: string): UserWrapped | undefined {
  return wrapped.users.find((u) => u.slug === slug);
}

/** Five distinct colors that read on both light and dark backgrounds, keyed by
 *  final rank order (1st → 5th). */
export const PALETTE = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#06b6d4", // cyan
] as const;

/** username → color, assigned in final-rank order. */
export const colorFor: Record<string, string> = Object.fromEntries(
  [...wrapped.users]
    .sort((a, b) => a.rank - b.rank)
    .map((u, i) => [u.username, PALETTE[i % PALETTE.length]]),
);

export const MEDALS = ["🥇", "🥈", "🥉"] as const;

/** Depth number (0..6) → human round label, for "how far a team went" copy. */
export const DEPTH_LABEL = ["Groups", "R32", "R16", "QF", "Semis", "Final", "Champion"];

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
