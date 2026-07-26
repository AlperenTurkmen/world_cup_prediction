"use client";

import { useEffect, useMemo, useState } from "react";
import type { Replay } from "@/lib/wrapped";
import { colorFor } from "./shared";

const EVENTS_PER_SECOND = 14;

/**
 * The full chronological race, animated: every scoring event across the whole
 * tournament (each of the 72 group games, each group's table locking in, each
 * knockout round's advancers being confirmed, each knockout game's tour points),
 * not just the six phase checkpoints. Defaults to fully drawn (a complete static
 * chart) so it's useful even without clicking anything; "Replay the race" restarts
 * the animation from kickoff.
 */
export default function ReplayRace({
  replay,
  highlight,
}: {
  replay: Replay;
  /** When set, that player's line is bold and the rest are dimmed. */
  highlight?: string;
}) {
  const { usernames, points } = replay;
  const n = points.length;

  const [frame, setFrame] = useState(n - 1);
  const [playing, setPlaying] = useState(false);

  // setInterval rather than requestAnimationFrame: rAF fully stops in a
  // backgrounded tab (a very plausible way to lose a running animation —
  // alt-tab mid-replay and come back to find it silently frozen), while
  // setInterval keeps ticking (just throttled to ~1/sec) so playback always
  // recovers. Delta-timed against Date.now() rather than a fixed step count,
  // so the pace stays correct regardless of actual fire interval.
  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    let acc = 0;
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      acc += dt * EVENTS_PER_SECOND;
      if (acc < 1) return;
      const advance = Math.floor(acc);
      acc -= advance;
      setFrame((f) => {
        const nf = f + advance;
        if (nf >= n - 1) {
          setPlaying(false);
          return n - 1;
        }
        return nf;
      });
    }, 1000 / EVENTS_PER_SECOND);
    return () => clearInterval(id);
  }, [playing, n]);

  function togglePlay() {
    if (frame >= n - 1) setFrame(0);
    setPlaying((p) => !p);
  }
  function scrub(value: number) {
    setPlaying(false);
    setFrame(value);
  }

  const maxY = useMemo(() => {
    const last = points[points.length - 1];
    return Math.max(...last.cumulative, 1);
  }, [points]);
  const niceMax = Math.ceil(maxY / 50) * 50;

  const phaseMarks = useMemo(
    () =>
      points
        .map((p, i) => ({ i, p }))
        .filter(({ p }) => p.kind === "advancement" || p.kind === "champion")
        .map(({ i, p }) => ({
          index: i,
          label: p.label.replace(" advancers confirmed", "").replace("Champion crowned", "Champion"),
        })),
    [points],
  );

  const W = 820;
  const H = 380;
  const padL = 44;
  const padR = 96;
  const padT = 24;
  const padB = 40;
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / niceMax);
  const gridY = Array.from({ length: 5 }, (_, i) => (niceMax / 4) * i);

  const visible = points.slice(0, frame + 1);
  const current = points[frame];
  const standings = usernames
    .map((u, idx) => ({ username: u, value: current.cumulative[idx] }))
    .sort((a, b) => b.value - a.value);

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[560px]"
          role="img"
          aria-label="Animated cumulative score race across the tournament"
        >
          {gridY.map((g) => (
            <g key={g}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y(g)}
                y2={y(g)}
                className="stroke-black/10 dark:stroke-white/15"
                strokeWidth={1}
              />
              <text x={padL - 8} y={y(g) + 4} textAnchor="end" className="fill-current text-[10px] opacity-50">
                {g}
              </text>
            </g>
          ))}

          {/* phase dividers */}
          {phaseMarks.map((m) => (
            <g key={m.index}>
              <line
                x1={x(m.index)}
                x2={x(m.index)}
                y1={padT}
                y2={H - padB}
                className="stroke-black/10 dark:stroke-white/10"
                strokeDasharray="3 3"
              />
              <text x={x(m.index)} y={H - padB + 14} textAnchor="middle" className="fill-current text-[10px] opacity-50">
                {m.label}
              </text>
            </g>
          ))}

          {usernames.map((u, idx) => {
            const color = colorFor[u];
            const dim = highlight !== undefined && u !== highlight;
            const pts = visible.map((p, i) => `${x(i)},${y(p.cumulative[idx])}`).join(" ");
            const last = current.cumulative[idx];
            return (
              <g key={u} opacity={dim ? 0.22 : 1}>
                <polyline points={pts} fill="none" stroke={color} strokeWidth={dim ? 1.5 : 2.5} strokeLinejoin="round" />
                <circle cx={x(frame)} cy={y(last)} r={dim ? 3 : 4.5} fill={color} />
                <text x={W - padR + 8} y={y(last) + 4} className="text-[11px] font-medium" style={{ fill: color }}>
                  {u.length > 12 ? u.slice(0, 11) + "…" : u} · {last}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* live status line */}
      <div className="mt-1 flex min-h-[20px] items-center gap-2 text-xs opacity-70">
        <span>{new Date(current.at).toISOString().slice(0, 10)}</span>
        <span className="opacity-40">·</span>
        <span className="truncate">{current.label}</span>
      </div>

      {/* controls */}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="shrink-0 cursor-pointer rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.06]"
        >
          {playing ? "⏸ Pause" : frame >= n - 1 ? "▶ Replay the race" : "▶ Play"}
        </button>
        <input
          type="range"
          min={0}
          max={n - 1}
          value={frame}
          onChange={(e) => scrub(Number(e.target.value))}
          className="w-full accent-indigo-500"
          aria-label="Scrub through the tournament"
        />
      </div>
    </div>
  );
}
