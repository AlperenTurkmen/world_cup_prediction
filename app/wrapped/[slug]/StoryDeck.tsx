"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UserWrapped, WrappedMeta } from "@/lib/wrapped";
import { DEPTH_LABEL, ordinal } from "../shared";

interface StoryDeckProps {
  user: UserWrapped;
  meta: WrappedMeta;
  color: string;
}

interface StoryCard {
  eyebrow: string;
  body: ReactNode;
}

const SWIPE_THRESHOLD = 50;

/**
 * A swipeable "story" deck of the punchiest highlights (docs/WRAPPED_PLAN.md §2:
 * "~12-18 of these as cards; the rest as a scrollable appendix"). Sits above the
 * full scrollable page, which serves as that appendix — this is a curated
 * re-presentation of the same data for a fast, mobile-first read.
 */
export default function StoryDeck({ user: u, meta, color }: StoryDeckProps) {
  const cards = buildCards(u, meta);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const go = (delta: number) => setIndex((i) => Math.min(cards.length - 1, Math.max(0, i + delta)));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    }
    const el = containerRef.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (dx > SWIPE_THRESHOLD) go(-1);
    else if (dx < -SWIPE_THRESHOLD) go(1);
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="mx-auto max-w-sm outline-none"
      aria-roledescription="carousel"
      aria-label={`${u.username}'s highlights`}
    >
      {/* progress segments */}
      <div className="flex gap-1">
        {cards.map((_, i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: i <= index ? "100%" : "0%", backgroundColor: color }}
            />
          </div>
        ))}
      </div>

      <div
        className="relative mt-3 overflow-hidden rounded-2xl border select-none"
        style={{ borderColor: color + "40" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {cards.map((card, i) => (
            <div key={i} className="w-full shrink-0 px-6 py-8" style={{ minHeight: 380 }}>
              <div className="text-xs font-semibold uppercase tracking-[0.15em] opacity-50">{card.eyebrow}</div>
              <div className="mt-4">{card.body}</div>
            </div>
          ))}
        </div>

        {/* tap zones (skip on the very first/last edge) */}
        <button
          type="button"
          aria-label="Previous card"
          onClick={() => go(-1)}
          className="absolute inset-y-0 left-0 w-1/3 cursor-pointer"
        />
        <button
          type="button"
          aria-label="Next card"
          onClick={() => go(1)}
          className="absolute inset-y-0 right-0 w-2/3 cursor-pointer"
        />
      </div>

      {/* dots + explicit controls */}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          className="rounded-full px-2 py-1 text-sm opacity-60 hover:opacity-100 disabled:opacity-20"
          aria-label="Previous"
        >
          ←
        </button>
        <div className="flex gap-1.5">
          {cards.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to card ${i + 1}`}
              className="h-1.5 w-1.5 rounded-full transition-opacity"
              style={{ backgroundColor: color, opacity: i === index ? 1 : 0.25 }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index === cards.length - 1}
          className="rounded-full px-2 py-1 text-sm opacity-60 hover:opacity-100 disabled:opacity-20"
          aria-label="Next"
        >
          →
        </button>
      </div>
      <p className="mt-1 text-center text-[11px] opacity-40">Swipe, tap the edges, or use ← →</p>
    </div>
  );
}

function Big({ children }: { children: ReactNode }) {
  return <div className="text-4xl font-black tabular-nums leading-none">{children}</div>;
}
function Label({ children }: { children: ReactNode }) {
  return <div className="mt-1 text-xs uppercase tracking-wide opacity-50">{children}</div>;
}

function buildCards(u: UserWrapped, meta: WrappedMeta): StoryCard[] {
  const medal = u.rank <= 3 ? ["🥇", "🥈", "🥉"][u.rank - 1] : `#${u.rank}`;
  const goalDelta = u.goalsPerGame - meta.groupGoalsPerGame;

  const cards: StoryCard[] = [
    {
      eyebrow: "World Cup 2026 Wrapped",
      body: (
        <div className="text-center">
          <div className="text-5xl">{u.persona.emoji}</div>
          <div className="mt-3 text-2xl font-black">{u.username}</div>
          <div className="mt-1 text-sm font-semibold uppercase tracking-wide opacity-70">{u.persona.name}</div>
          <p className="mx-auto mt-3 max-w-xs text-sm opacity-60">{u.persona.scoutingReport}</p>
        </div>
      ),
    },
    {
      eyebrow: "The headline",
      body: (
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <Big>{u.total}</Big>
            <Label>points</Label>
          </div>
          <div>
            <Big>{medal}</Big>
            <Label>finish</Label>
          </div>
          <div>
            <Big>{u.exactCountRaw}</Big>
            <Label>exacts</Label>
          </div>
        </div>
      ),
    },
    {
      eyebrow: "Where it came from",
      body: (
        <div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <Big>{u.groupPoints}</Big>
              <Label>group</Label>
            </div>
            <div>
              <Big>{u.rankingPoints}</Big>
              <Label>ranking</Label>
            </div>
            <div>
              <Big>{u.knockoutPoints}</Big>
              <Label>knockout</Label>
            </div>
          </div>
          <p className="mt-4 text-center text-sm opacity-70">
            Best phase: <strong>{u.bestPhase}</strong>
          </p>
        </div>
      ),
    },
    {
      eyebrow: "Best single call 🎯",
      body: (
        <div className="text-center">
          <div className="text-lg font-bold">
            {u.bestGame.home} {u.bestGame.predHome}–{u.bestGame.predAway} {u.bestGame.away}
          </div>
          <p className="mt-2 text-sm opacity-60">
            Actual: {u.bestGame.actualHome}–{u.bestGame.actualAway} · {u.bestGame.points} pts
            {u.bestGame.isExact && " · exact ✨"}
          </p>
        </div>
      ),
    },
    {
      eyebrow: u.bestSoloCall ? "Only you saw it 🃏" : "Contrarian streak 🃏",
      body: u.bestSoloCall ? (
        <div className="text-center">
          <div className="text-lg font-bold">
            {u.bestSoloCall.home} {u.bestSoloCall.predHome}–{u.bestSoloCall.predAway} {u.bestSoloCall.away}
          </div>
          <p className="mt-2 text-sm opacity-60">
            {u.soloCorrectCount} call{u.soloCorrectCount === 1 ? "" : "s"} in the pool that only you got right.
          </p>
        </div>
      ) : (
        <div className="text-center">
          <Big>{u.maverickScore}</Big>
          <p className="mt-2 text-sm opacity-60">times you went against the pool majority (of 72)</p>
        </div>
      ),
    },
    {
      eyebrow: "Biggest whiff 😬",
      body: (
        <div className="text-center">
          <div className="text-lg font-bold">
            {u.worstGame.home} {u.worstGame.predHome}–{u.worstGame.predAway} {u.worstGame.away}
          </div>
          <p className="mt-2 text-sm opacity-60">
            It actually ended {u.worstGame.actualHome}–{u.worstGame.actualAway}.
          </p>
          <p className="mt-4 text-sm opacity-70">
            Plus <strong>{u.nearMissCount}</strong> more scores exactly one goal from perfect.
          </p>
        </div>
      ),
    },
    {
      eyebrow: "Your tendencies",
      body: (
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="text-2xl font-black tabular-nums">{u.goalsPerGame.toFixed(2)}</div>
            <Label>
              goals/game ({goalDelta >= 0 ? "+" : ""}
              {goalDelta.toFixed(2)} vs reality)
            </Label>
          </div>
          <div>
            <div className="text-2xl font-black tabular-nums">{u.drawsPredicted}</div>
            <Label>draws called</Label>
          </div>
          <div>
            <div className="text-2xl font-black tabular-nums">
              {u.homeBias >= 0 ? "+" : ""}
              {u.homeBias.toFixed(2)}
            </div>
            <Label>home bias</Label>
          </div>
          <div>
            <div className="text-2xl font-black tabular-nums">{u.favoriteScoreline.score.replace("-", "–")}</div>
            <Label>comfort score ({u.favoriteScoreline.count}×)</Label>
          </div>
        </div>
      ),
    },
    {
      eyebrow: "Your champion 🏆",
      body: (
        <div className="text-center">
          <div className="text-2xl font-black">
            {u.championPick} {u.championCorrect && "✓"}
          </div>
          <p className="mt-2 text-sm opacity-60">
            {u.championCorrect
              ? "You called it — the actual champion."
              : `They reached the ${DEPTH_LABEL[u.championJourneyRounds]} — you rode with them ${u.championJourneyRounds} round${u.championJourneyRounds === 1 ? "" : "s"}.`}
          </p>
        </div>
      ),
    },
    {
      eyebrow: "The knockouts",
      body: (
        <div className="text-center">
          <p className="text-sm">
            Correctly predicted advancers — QF <strong>{u.bracketSurvival.qf}</strong>, SF{" "}
            <strong>{u.bracketSurvival.sf}</strong>, Finalists <strong>{u.bracketSurvival.finalists}</strong>
          </p>
          {u.tourGamesPlayed > 0 ? (
            <p className="mt-3 text-sm opacity-70">
              {u.tourPoints} pts across {u.tourGamesPlayed} real knockout games ({u.tourExacts} exact
              {u.tourExacts === 1 ? "" : "s"}).
            </p>
          ) : (
            <p className="mt-3 text-sm opacity-50">Sat out the knockout tours.</p>
          )}
          {u.foresightPoints > 0 && (
            <p className="mt-2 text-sm text-fuchsia-500">🔮 +{u.foresightPoints} foresight — called it before a ball was kicked.</p>
          )}
        </div>
      ),
    },
    {
      eyebrow: "Teams",
      body: (
        <div className="grid grid-cols-1 gap-3 text-center">
          {u.mvpTeam && (
            <div>
              <div className="text-lg font-bold">⭐ {u.mvpTeam.team}</div>
              <Label>your MVP — {u.mvpTeam.points} pts earned</Label>
            </div>
          )}
          {u.kryptoniteGroup && (
            <div>
              <div className="text-lg font-bold">🪨 Group {u.kryptoniteGroup.group}</div>
              <Label>your kryptonite — only {u.kryptoniteGroup.points} pts</Label>
            </div>
          )}
        </div>
      ),
    },
    {
      eyebrow: "You vs the group",
      body: (
        <div className="grid grid-cols-1 gap-3 text-center">
          {u.twin && (
            <div>
              <div className="text-lg font-bold">🧠 {u.twin.username}</div>
              <Label>twin brain — {u.twin.identical}/72 identical</Label>
            </div>
          )}
          {u.closestRival && (
            <div>
              <div className="text-lg font-bold">🥊 {u.closestRival.username}</div>
              <Label>closest rival — {u.closestRival.margin} pts apart</Label>
            </div>
          )}
        </div>
      ),
    },
    {
      eyebrow: "Your race",
      body: (
        <div className="text-center">
          <p className="text-sm">
            Peaked at <strong>{ordinal(Math.min(...u.rankAt))}</strong>, finished <strong>{ordinal(u.rank)}</strong>.
          </p>
          <p className="mt-2 text-sm opacity-60">
            {ordinal(u.submissionRank)} of 5 to lock in predictions, on {new Date(u.submittedAt).toISOString().slice(0, 10)}.
          </p>
        </div>
      ),
    },
    {
      eyebrow: "That's a wrap",
      body: (
        <div className="text-center">
          <div className="text-3xl">⚽</div>
          <p className="mt-3 text-sm opacity-70">
            Scroll down for the full breakdown, the animated race replay, and a shareable card.
          </p>
        </div>
      ),
    },
  ];

  return cards;
}
