import type { WrappedData } from "@/lib/wrapped";
import { colorFor } from "./shared";

/**
 * The race: each player's cumulative score across the tournament checkpoints
 * (end of groups → R32 → R16 → QF → SF → final). Pure inline SVG so it renders
 * statically on the server; the wrapper scrolls horizontally on narrow screens.
 */
export default function Timeline({
  timeline,
  highlight,
}: {
  timeline: WrappedData["global"]["timeline"];
  /** When set, that player's line is bold and the rest are dimmed. */
  highlight?: string;
}) {
  const { checkpoints, series } = timeline;
  const W = 820;
  const H = 380;
  const padL = 44;
  const padR = 96; // room for end labels
  const padT = 24;
  const padB = 36;
  const maxScore = Math.max(...series.flatMap((s) => s.cumulative), 1);
  const niceMax = Math.ceil(maxScore / 50) * 50;

  const x = (i: number) => padL + (i * (W - padL - padR)) / (checkpoints.length - 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / niceMax);

  const gridY = Array.from({ length: 5 }, (_, i) => (niceMax / 4) * i);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[560px]"
        role="img"
        aria-label="Cumulative score race across the tournament"
      >
        {/* gridlines + y labels */}
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

        {/* x labels */}
        {checkpoints.map((c, i) => (
          <text key={c} x={x(i)} y={H - 12} textAnchor="middle" className="fill-current text-[11px] opacity-60">
            {c}
          </text>
        ))}

        {/* one line per player */}
        {series.map((s) => {
          const color = colorFor[s.username];
          const dim = highlight !== undefined && s.username !== highlight;
          const pts = s.cumulative.map((v, i) => `${x(i)},${y(v)}`).join(" ");
          const last = s.cumulative[s.cumulative.length - 1];
          return (
            <g key={s.username} opacity={dim ? 0.22 : 1}>
              <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth={dim ? 1.5 : 2.5}
                strokeLinejoin="round"
              />
              {s.cumulative.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={dim ? 2 : 3} fill={color} />
              ))}
              <text
                x={W - padR + 8}
                y={y(last) + 4}
                className="text-[11px] font-medium"
                style={{ fill: color }}
              >
                {s.username.length > 12 ? s.username.slice(0, 11) + "…" : s.username}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
