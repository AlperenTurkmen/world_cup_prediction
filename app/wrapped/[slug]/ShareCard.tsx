"use client";

import { useEffect, useRef, useState } from "react";

interface ShareCardProps {
  username: string;
  persona: string;
  rank: number;
  playerCount: number;
  total: number;
  exacts: number;
  championPick: string | null;
  championCorrect: boolean;
  color: string;
  twin: string | null;
}

const MEDALS = ["🥇", "🥈", "🥉"];

// Canvas is drawn at 2× the CSS size for a crisp export.
const W = 680;
const H = 520;

/**
 * A screenshot-ready summary card drawn straight onto a <canvas>, plus a
 * "download PNG" button. Drawing manually (rather than DOM-to-image) keeps the
 * export 100% client-side, dependency-free, and reliable — canvas.toDataURL
 * never stalls the way html-to-image can on font/SVG loads.
 */
export default function ShareCard(props: ShareCardProps) {
  const { username, persona, rank, playerCount, total, exacts, championPick, championCorrect, color, twin } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // rounded-rect clip
    const r = 32;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(W, 0, W, H, r);
    ctx.arcTo(W, H, 0, H, r);
    ctx.arcTo(0, H, 0, 0, r);
    ctx.arcTo(0, 0, W, 0, r);
    ctx.closePath();
    ctx.clip();

    // gradient background
    const g = ctx.createLinearGradient(0, 0, W * 0.5, H);
    g.addColorStop(0, color);
    g.addColorStop(0.62, "#0a0a0a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const font = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    const text = (
      s: string,
      x: number,
      y: number,
      size: number,
      weight: number,
      alpha: number,
      align: CanvasTextAlign = "left",
    ) => {
      ctx.font = `${weight} ${size}px ${font}`;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.textAlign = align;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(s, x, y);
    };

    const pad = 48;
    // header
    text("WORLD CUP 2026", pad, 62, 20, 700, 0.85);
    text("WRAPPED", W - pad, 62, 20, 700, 0.85, "right");
    // identity
    text(username, pad, 150, 46, 800, 1);
    text(persona, pad, 188, 24, 500, 0.9);
    // stats row
    const statY = 300;
    const medal = rank <= 3 ? MEDALS[rank - 1] : `#${rank}`;
    text(String(total), pad, statY, 62, 800, 1);
    text("POINTS", pad, statY + 28, 18, 700, 0.7);
    text(medal, 250, statY, 54, 800, 1);
    text(`OF ${playerCount}`, 250, statY + 28, 18, 700, 0.7);
    text(String(exacts), 430, statY, 62, 800, 1);
    text("EXACTS", 430, statY + 28, 18, 700, 0.7);
    // details
    text("Champion pick", pad, 392, 22, 500, 0.72);
    text(`${championPick ?? "—"}${championCorrect ? "  ✓" : ""}`, W - pad, 392, 22, 700, 1, "right");
    if (twin) {
      text("Twin brain", pad, 430, 22, 500, 0.72);
      text(twin, W - pad, 430, 22, 700, 1, "right");
    }
    // footer
    text("wc2026 predictions · wrapped", pad, 486, 17, 500, 0.6);

    setReady(true);
  }, [username, persona, rank, playerCount, total, exacts, championPick, championCorrect, color, twin]);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `wc2026-wrapped-${username.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div>
      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="w-[340px] max-w-full rounded-2xl border border-white/10 shadow-lg"
          style={{ aspectRatio: `${W} / ${H}` }}
        />
      </div>
      <div className="mt-4 flex items-center justify-center">
        <button
          type="button"
          onClick={download}
          disabled={!ready}
          className="cursor-pointer rounded-full px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: color }}
        >
          ⬇ Download card (PNG)
        </button>
      </div>
    </div>
  );
}
