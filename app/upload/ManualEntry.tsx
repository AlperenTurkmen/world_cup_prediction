"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deriveBracket,
  KNOCKOUT_ROUNDS,
  PICKABLE_KO_MATCHES,
  type GroupFixture,
  type GroupScores,
  type KnockoutScores,
} from "@/lib/deriveBracket";
import { MAX_GOALS, MAX_USERNAME_LEN } from "@/lib/manualEntry";

export interface ClientFixture {
  matchNo: number;
  home: string;
  away: string;
  group: string;
  kickoffAt: string | null;
  started: boolean;
}

interface InitialDraft {
  username: string;
  groupScores: Record<string, { h: number; a: number }>;
  koScores: Record<string, { h: number; a: number; pen?: string }>;
}

interface ManualEntryProps {
  googleEmail: string;
  fixtures: ClientFixture[];
  initialDraft: InitialDraft | null;
}

type Phase = "group" | "knockout" | "submit";
type ScoreMap = Record<number, { h: number; a: number }>;
type WinnerMap = Record<number, string>;

const RAIL = [0, 1, 2, 3, 4];

function chronological(a: ClientFixture, b: ClientFixture): number {
  const ta = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.POSITIVE_INFINITY;
  const tb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return a.matchNo - b.matchNo;
}

export default function ManualEntry({ googleEmail, fixtures, initialDraft }: ManualEntryProps) {
  // Only games that haven't kicked off are shown; the rest auto-fill 0–0 server-side.
  const upcoming = useMemo(() => fixtures.filter((f) => !f.started).sort(chronological), [fixtures]);
  const derivationFixtures = useMemo<GroupFixture[]>(
    () => fixtures.map((f) => ({ matchNo: f.matchNo, home: f.home, away: f.away, group: f.group })),
    [fixtures],
  );

  const [scores, setScores] = useState<ScoreMap>(() => {
    const m: ScoreMap = {};
    for (const [k, v] of Object.entries(initialDraft?.groupScores ?? {})) m[Number(k)] = v;
    return m;
  });
  const [winners, setWinners] = useState<WinnerMap>({});
  const [username, setUsername] = useState(initialDraft?.username ?? "");
  const [password, setPassword] = useState("");

  const [phase, setPhase] = useState<Phase>("group");
  const [index, setIndex] = useState(() => {
    const filled = (no: number) => initialDraft?.groupScores?.[String(no)] != null;
    const first = upcoming.findIndex((f) => !filled(f.matchNo));
    return first === -1 ? 0 : first;
  });
  const [focusedSide, setFocusedSide] = useState<"home" | "away">("home");

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    username: string;
    predictionsSaved: number;
    latePredictionCount: number;
    champion: string;
  } | null>(null);

  const filledCount = upcoming.filter((f) => scores[f.matchNo] != null).length;
  const allGroupsFilled = filledCount === upcoming.length && upcoming.length > 0;

  // Full 72-match grid for derivation (unfilled / past games count as 0–0).
  const derivationScores = useMemo<GroupScores>(() => {
    const gs: GroupScores = {};
    for (const f of fixtures) {
      const s = scores[f.matchNo];
      gs[f.matchNo] = s ? { home: s.h, away: s.a } : { home: 0, away: 0 };
    }
    return gs;
  }, [fixtures, scores]);

  const koScores = useMemo<KnockoutScores>(() => {
    const out: KnockoutScores = {};
    for (let pass = 0; pass < PICKABLE_KO_MATCHES.length; pass++) {
      let changed = false;
      const { matchups } = deriveBracket(derivationFixtures, derivationScores, out);
      for (const no of PICKABLE_KO_MATCHES) {
        const winner = winners[no];
        const matchup = matchups.get(no);
        if (!winner || !matchup?.home || !matchup.away) continue;
        const next =
          winner === matchup.home
            ? { home: 1, away: 0, penaltyWinner: null }
            : winner === matchup.away
              ? { home: 0, away: 1, penaltyWinner: null }
              : null;
        if (!next) continue;
        const cur = out[no];
        if (!cur || cur.home !== next.home || cur.away !== next.away) {
          out[no] = next;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return out;
  }, [derivationFixtures, derivationScores, winners]);

  const bracket = useMemo(
    () => deriveBracket(derivationFixtures, derivationScores, koScores),
    [derivationFixtures, derivationScores, koScores],
  );

  // ---- Group score editing -------------------------------------------------
  const setScore = useCallback((matchNo: number, side: "home" | "away", goals: number) => {
    const g = Math.max(0, Math.min(MAX_GOALS, goals));
    setScores((prev) => {
      const cur = prev[matchNo] ?? { h: 0, a: 0 };
      return { ...prev, [matchNo]: side === "home" ? { ...cur, h: g } : { ...cur, a: g } };
    });
  }, []);

  const goNext = useCallback(
    () => setIndex((i) => Math.min(upcoming.length - 1, i + 1)),
    [upcoming.length],
  );
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const pickGoals = useCallback(
    (side: "home" | "away", goals: number) => {
      const fx = upcoming[index];
      if (!fx) return;
      setScore(fx.matchNo, side, goals);
      if (side === "home") {
        setFocusedSide("away");
      } else {
        setFocusedSide("home");
        goNext();
      }
    },
    [upcoming, index, setScore, goNext],
  );

  // Keyboard: digits fill the focused side then advance; arrows navigate.
  useEffect(() => {
    if (phase !== "group") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pickGoals(focusedSide, Number(e.key));
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        setFocusedSide("home");
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusedSide("home");
        goPrev();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedSide("home");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedSide("away");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, focusedSide, pickGoals, goNext, goPrev]);

  // ---- Knockout winner picking --------------------------------------------
  const pickWinner = useCallback(
    (matchNo: number, team: string) => {
      setWinners((prev) => {
        const next: WinnerMap = { ...prev, [matchNo]: team };
        // A changed pick can invalidate downstream picks (their participants
        // shift). Recompute and drop any winner that's no longer a participant,
        // repeating until the bracket is internally consistent.
        let changed = true;
        while (changed) {
          changed = false;
          const nextScores: KnockoutScores = {};
          const { matchups } = deriveBracket(derivationFixtures, derivationScores, nextScores);
          for (const no of PICKABLE_KO_MATCHES) {
            const w = next[no];
            if (!w) continue;
            const m = matchups.get(no);
            if (m && m.home && m.away && m.home !== w && m.away !== w) {
              delete next[no];
              changed = true;
            }
          }
        }
        return next;
      });
    },
    [derivationFixtures, derivationScores],
  );

  // ---- Draft persistence ---------------------------------------------------
  const saveDraft = useCallback(
    async (silent = false) => {
      if (!silent) setSaveState("saving");
      try {
        const groupScores: Record<string, { h: number; a: number }> = {};
        for (const [k, v] of Object.entries(scores)) groupScores[k] = v;
        const draftKoScores: Record<string, { h: number; a: number; pen?: string }> = {};
        for (const [k, v] of Object.entries(koScores)) draftKoScores[k] = { h: v.home, a: v.away };
        const res = await fetch("/api/draft", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, groupScores, koScores: draftKoScores }),
        });
        if (!res.ok) throw new Error("save failed");
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [scores, koScores, username],
  );

  // Debounced autosave so progress survives even without an explicit save.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (result) return;
    const t = setTimeout(() => void saveDraft(true), 2500);
    return () => clearTimeout(t);
  }, [scores, winners, username, result, saveDraft]);

  // ---- Submit --------------------------------------------------------------
  const canSubmit = username.trim().length > 0 && bracket.complete && !submitting;
  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const groupScores: Record<string, { h: number; a: number }> = {};
      for (const [k, v] of Object.entries(scores)) groupScores[k] = v;
      const submitKoScores: Record<string, { h: number; a: number; pen?: string }> = {};
      for (const [k, v] of Object.entries(koScores)) submitKoScores[k] = { h: v.home, a: v.away };
      const res = await fetch("/api/upload/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, groupScores, koScores: submitKoScores }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Success screen ------------------------------------------------------
  if (result) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">Entry submitted</h1>
        <div className="mt-4 rounded-lg border border-green-600/30 bg-green-600/10 p-4 text-sm">
          <p>
            Thanks, <strong>{result.username}</strong>! We saved{" "}
            <strong>{result.predictionsSaved}</strong> group predictions and your knockout picks.
          </p>
          <p className="mt-2">
            Your predicted champion: <strong>{result.champion}</strong>.
          </p>
          {result.latePredictionCount > 0 && (
            <p className="mt-2">
              Note: <strong>{result.latePredictionCount}</strong> games had already kicked off, so
              those won&apos;t be included in your score.
            </p>
          )}
        </div>
        <Link href="/" className="mt-6 inline-block text-sm font-medium underline">
          View the leaderboard
        </Link>
      </main>
    );
  }

  if (upcoming.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">No upcoming games</h1>
        <p className="mt-2 text-sm opacity-70">
          Every group game has already kicked off, so there&apos;s nothing left to predict.
        </p>
      </main>
    );
  }

  const current = upcoming[index];
  const currentScore = scores[current.matchNo];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Enter your predictions</h1>
          <p className="mt-1 text-sm opacity-60">
            Signed in as {googleEmail}. Progress saves automatically — you can leave and finish later.
          </p>
        </div>
        <SaveBadge state={saveState} onSave={() => void saveDraft(false)} />
      </header>

      <PhaseTabs phase={phase} setPhase={setPhase} allGroupsFilled={allGroupsFilled} />

      {phase === "group" && (
        <GroupStepper
          fixture={current}
          score={currentScore}
          focusedSide={focusedSide}
          setFocusedSide={setFocusedSide}
          onPick={pickGoals}
          index={index}
          total={upcoming.length}
          filledCount={filledCount}
          onPrev={goPrev}
          onNext={goNext}
          upcoming={upcoming}
          scores={scores}
          onJump={(i) => setIndex(i)}
          onDone={() => setPhase("knockout")}
        />
      )}

      {phase === "knockout" && (
        <KnockoutPicker
          bracket={bracket}
          winners={winners}
          onPick={pickWinner}
          allGroupsFilled={allGroupsFilled}
          onBack={() => setPhase("group")}
          onDone={() => setPhase("submit")}
        />
      )}

      {phase === "submit" && (
        <SubmitPanel
          username={username}
          setUsername={setUsername}
          password={password}
          setPassword={setPassword}
          complete={bracket.complete}
          champion={bracket.advancers.CHAMPION}
          canSubmit={canSubmit}
          submitting={submitting}
          error={error}
          onSubmit={handleSubmit}
          onBack={() => setPhase("knockout")}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

function SaveBadge({ state, onSave }: { state: string; onSave: () => void }) {
  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : state === "error" ? "Save failed" : "Save";
  return (
    <button
      type="button"
      onClick={onSave}
      className="shrink-0 rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium dark:border-white/20"
    >
      {label}
    </button>
  );
}

function PhaseTabs({
  phase,
  setPhase,
  allGroupsFilled,
}: {
  phase: Phase;
  setPhase: (p: Phase) => void;
  allGroupsFilled: boolean;
}) {
  const tabs: Array<{ id: Phase; label: string; enabled: boolean }> = [
    { id: "group", label: "1. Group games", enabled: true },
    { id: "knockout", label: "2. Knockouts", enabled: allGroupsFilled },
    { id: "submit", label: "3. Submit", enabled: allGroupsFilled },
  ];
  return (
    <nav className="mt-6 flex gap-2 text-xs font-medium">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={!t.enabled}
          onClick={() => setPhase(t.id)}
          className={`rounded-full px-3 py-1.5 transition-colors ${
            phase === t.id
              ? "bg-foreground text-background"
              : "border border-black/15 disabled:opacity-40 dark:border-white/20"
          }`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function GroupStepper({
  fixture,
  score,
  focusedSide,
  setFocusedSide,
  onPick,
  index,
  total,
  filledCount,
  onPrev,
  onNext,
  upcoming,
  scores,
  onJump,
  onDone,
}: {
  fixture: ClientFixture;
  score: { h: number; a: number } | undefined;
  focusedSide: "home" | "away";
  setFocusedSide: (s: "home" | "away") => void;
  onPick: (side: "home" | "away", goals: number) => void;
  index: number;
  total: number;
  filledCount: number;
  onPrev: () => void;
  onNext: () => void;
  upcoming: ClientFixture[];
  scores: ScoreMap;
  onJump: (i: number) => void;
  onDone: () => void;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between text-xs opacity-60">
        <span>
          Game {index + 1} of {total}
        </span>
        <span>{filledCount} filled</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className="h-full bg-foreground transition-all"
          style={{ width: `${total ? (filledCount / total) * 100 : 0}%` }}
        />
      </div>

      <div className="mt-6 flex items-stretch gap-3">
        <Rail side="home" value={score?.h} focused={focusedSide === "home"} onPick={(g) => onPick("home", g)} />

        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-black/10 px-3 py-6 dark:border-white/15">
          <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide opacity-70 dark:bg-white/10">
            Group {fixture.group} · Match {fixture.matchNo}
          </span>
          <div className="mt-4 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button
              type="button"
              onClick={() => setFocusedSide("home")}
              className={`truncate text-right text-base font-semibold ${
                focusedSide === "home" ? "" : "opacity-80"
              }`}
            >
              {fixture.home}
            </button>
            <div className="flex items-center gap-2 text-3xl font-bold tabular-nums">
              <ScoreBox value={score?.h} active={focusedSide === "home"} onClick={() => setFocusedSide("home")} />
              <span className="opacity-30">:</span>
              <ScoreBox value={score?.a} active={focusedSide === "away"} onClick={() => setFocusedSide("away")} />
            </div>
            <button
              type="button"
              onClick={() => setFocusedSide("away")}
              className={`truncate text-left text-base font-semibold ${
                focusedSide === "away" ? "" : "opacity-80"
              }`}
            >
              {fixture.away}
            </button>
          </div>
          <p className="mt-4 text-center text-[11px] opacity-50">
            Tap the numbers on either side, or type on your keyboard (digits fill the highlighted box).
          </p>
        </div>

        <Rail side="away" value={score?.a} focused={focusedSide === "away"} onPick={(g) => onPick("away", g)} />
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          disabled={index === 0}
          className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium disabled:opacity-30 dark:border-white/20"
        >
          ← Prev
        </button>
        {index === total - 1 ? (
          <button
            type="button"
            onClick={onDone}
            disabled={filledCount !== total}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            Continue to knockouts →
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
          >
            Next →
          </button>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-1.5">
        {upcoming.map((f, i) => {
          const done = scores[f.matchNo] != null;
          return (
            <button
              key={f.matchNo}
              type="button"
              onClick={() => onJump(i)}
              title={`${f.home} v ${f.away}`}
              className={`h-6 w-6 rounded text-[10px] font-medium transition-colors ${
                i === index
                  ? "bg-foreground text-background"
                  : done
                    ? "bg-green-600/20 text-green-800 dark:text-green-300"
                    : "bg-black/5 opacity-60 dark:bg-white/10"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {filledCount === total && (
        <button
          type="button"
          onClick={onDone}
          className="mt-6 w-full rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background"
        >
          All {total} games filled — continue to knockouts →
        </button>
      )}
    </section>
  );
}

function Rail({
  side,
  value,
  focused,
  onPick,
}: {
  side: "home" | "away";
  value: number | undefined;
  focused: boolean;
  onPick: (g: number) => void;
}) {
  return (
    <div
      className={`flex flex-col justify-center gap-1.5 ${focused ? "" : "opacity-90"}`}
      aria-label={`${side} score`}
    >
      {RAIL.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick(n)}
          className={`h-10 w-10 rounded-lg text-lg font-bold tabular-nums transition-colors ${
            value === n
              ? "bg-foreground text-background"
              : "border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function ScoreBox({ value, active, onClick }: { value: number | undefined; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-12 w-12 items-center justify-center rounded-lg border-2 ${
        active ? "border-foreground" : "border-black/15 dark:border-white/20"
      }`}
    >
      {value ?? <span className="opacity-25">–</span>}
    </button>
  );
}

function KnockoutPicker({
  bracket,
  winners,
  onPick,
  allGroupsFilled,
  onBack,
  onDone,
}: {
  bracket: ReturnType<typeof deriveBracket>;
  winners: WinnerMap;
  onPick: (matchNo: number, team: string) => void;
  allGroupsFilled: boolean;
  onBack: () => void;
  onDone: () => void;
}) {
  if (!allGroupsFilled) {
    return (
      <section className="mt-6 rounded-lg border border-amber-600/30 bg-amber-600/10 p-4 text-sm">
        Fill in all group games first — the knockout matchups are worked out from your predicted
        group standings.
        <button type="button" onClick={onBack} className="mt-3 block font-medium underline">
          ← Back to group games
        </button>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <p className="text-sm opacity-70">
        Your predicted standings set the Round of 32. Tap the winner of each tie — your picks feed
        the next round all the way to the champion.
      </p>

      <div className="mt-5 space-y-6">
        {KNOCKOUT_ROUNDS.map((round) => (
          <div key={round.round}>
            <h3 className="text-sm font-semibold">{round.label}</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {round.matches.map((no) => {
                const m = bracket.matchups.get(no);
                const winner = winners[no];
                return (
                  <div
                    key={no}
                    className="overflow-hidden rounded-lg border border-black/10 dark:border-white/15"
                  >
                    {m?.home && m?.away ? (
                      [m.home, m.away].map((team) => (
                        <button
                          key={team}
                          type="button"
                          onClick={() => onPick(no, team!)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors ${
                            winner === team
                              ? "bg-foreground font-semibold text-background"
                              : "hover:bg-black/5 dark:hover:bg-white/10"
                          }`}
                        >
                          <span className="truncate">{team}</span>
                          {winner === team && <span className="ml-2 text-xs">✓</span>}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-center text-xs opacity-40">
                        Awaiting earlier results
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-black/10 p-4 text-center dark:border-white/15">
        <p className="text-xs uppercase tracking-wide opacity-50">Predicted champion</p>
        <p className="mt-1 text-lg font-bold">{bracket.advancers.CHAMPION || "—"}</p>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
        >
          ← Group games
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={!bracket.complete}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          Continue to submit →
        </button>
      </div>
    </section>
  );
}

function SubmitPanel({
  username,
  setUsername,
  password,
  setPassword,
  complete,
  champion,
  canSubmit,
  submitting,
  error,
  onSubmit,
  onBack,
}: {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  complete: boolean;
  champion: string;
  canSubmit: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <section className="mt-6 space-y-6">
      {!complete && (
        <div className="rounded-lg border border-amber-600/30 bg-amber-600/10 p-3 text-sm">
          Finish picking every knockout winner before submitting.
        </div>
      )}
      <div className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
        Predicted champion: <strong>{champion || "—"}</strong>. Once you submit, your entry is final
        and can&apos;t be changed.
      </div>

      <div>
        <label htmlFor="username" className="block text-sm font-medium">
          Your prediction username
        </label>
        <input
          id="username"
          type="text"
          value={username}
          maxLength={MAX_USERNAME_LEN}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. alex"
          className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Optional password fallback
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave blank to use Google only"
          className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
        <p className="mt-1 text-xs opacity-60">If you set one, it must be at least 6 characters.</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-600/30 bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
        >
          ← Knockouts
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Submit entry"}
        </button>
      </div>
    </section>
  );
}
