import type { Metadata } from "next";
import Link from "next/link";
import { wrapped, colorFor, MEDALS, DEPTH_LABEL } from "./shared";
import { Section, Card, Stat, BreakdownBar, Pill, Score } from "./ui";
import Timeline from "./Timeline";
import AgreementHeatmap from "./AgreementHeatmap";

export const metadata: Metadata = {
  title: "World Cup 2026 — Wrapped",
  description: "The story of our five predictors' World Cup: the race, the awards, the blind spots.",
};

// The dataset is frozen (precomputed JSON), so render this page fully static.
export const dynamic = "force-static";

const { meta, global, users } = wrapped;
const maxTotal = Math.max(...global.leaderboard.map((r) => r.total), 1);

export default function WrappedGlobalPage() {
  const podium = global.podium;
  // podium display order: 2nd, 1st, 3rd
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean);
  const podiumHeights = ["h-24", "h-32", "h-20"];
  const winner = users.find((u) => u.rank === 1);
  const runnerUp = global.leaderboard.find((r) => r.rank === 2);
  const margin = winner && runnerUp ? winner.total - runnerUp.total : 0;
  // When did the winner take (and keep) the lead?
  const winnerLeadChanges = global.timeline.leadChanges.filter((lc) => lc.leader === winner?.username);
  const sealing = winnerLeadChanges[winnerLeadChanges.length - 1];
  const sealingText =
    sealing && sealing.checkpoint === "Groups"
      ? "Led from the group stage and never let go."
      : sealing
        ? `Took the lead at the ${sealing.checkpoint} and held on.`
        : "";

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {/* ── Hero ── */}
      <header className="text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] opacity-60">World Cup 2026</p>
        <h1 className="mt-2 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-amber-500 bg-clip-text text-4xl font-black tracking-tight text-transparent sm:text-5xl">
          Wrapped
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm opacity-70">
          Five friends. 104 games. One champion (<strong>{meta.champion}</strong> 🏆). Here&apos;s
          how everyone&apos;s predictions actually played out.
        </p>
      </header>

      {/* ── Podium ── */}
      <div className="mt-10 flex items-end justify-center gap-3">
        {podiumOrder.map((r, i) => {
          const place = r === podium[0] ? 1 : r === podium[1] ? 2 : 3;
          return (
            <Link
              key={r.entry_id}
              href={`/wrapped/${users.find((u) => u.entryId === r.entry_id)?.slug ?? ""}`}
              className="group flex w-24 flex-col items-center sm:w-28"
            >
              <div className="text-2xl">{MEDALS[place - 1]}</div>
              <div className="mt-1 truncate text-center text-xs font-semibold group-hover:underline" title={r.username}>
                {r.username}
              </div>
              <div className="text-xs opacity-60">{r.total} pts</div>
              <div
                className={`mt-2 w-full rounded-t-lg ${podiumHeights[i]} border border-b-0 border-black/10 dark:border-white/15`}
                style={{ backgroundColor: colorFor[r.username] + "22" }}
              />
            </Link>
          );
        })}
      </div>
      {/* ── Champion spotlight ── */}
      {winner && (
        <div
          className="mt-8 overflow-hidden rounded-2xl border p-6 text-center"
          style={{
            borderColor: colorFor[winner.username] + "66",
            background: `radial-gradient(120% 120% at 50% 0%, ${colorFor[winner.username]}22, transparent 70%)`,
          }}
        >
          <div className="text-3xl">👑</div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] opacity-60">Our champion predictor</div>
          <h2 className="mt-1 text-2xl font-black tracking-tight" style={{ color: colorFor[winner.username] }}>
            {winner.username}
          </h2>
          <p className="mt-1 text-sm opacity-70">
            {winner.persona.emoji} {winner.persona.name} · {winner.total} pts
            {margin > 0 && <> · won by {margin}</>}
          </p>
          {sealingText && <p className="mt-2 text-sm opacity-80">{sealingText}</p>}
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
            <Pill>🎯 {winner.exactCountRaw} exact scores</Pill>
            <Pill>
              🏆 backed {winner.championPick}
              {winner.championCorrect && " ✓"}
            </Pill>
            <Pill>
              🦸 best call: {winner.bestGame.home} <Score h={winner.bestGame.predHome} a={winner.bestGame.predAway} />{" "}
              {winner.bestGame.away}
            </Pill>
          </div>
          <Link
            href={`/wrapped/${winner.slug}`}
            className="mt-4 inline-block rounded-full px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: colorFor[winner.username] }}
          >
            See {winner.username}&apos;s full Wrapped →
          </Link>
        </div>
      )}

      {/* ── Full leaderboard ── */}
      <Section title="The final table" subtitle="Group · ranking · knockout points, stacked.">
        <div className="space-y-2">
          {global.leaderboard.map((r) => {
            const u = users.find((x) => x.entryId === r.entry_id)!;
            return (
              <Card key={r.entry_id} className="flex items-center gap-3">
                <div className="w-6 text-center text-sm font-bold opacity-60">{r.rank}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/wrapped/${u.slug}`} className="truncate font-semibold hover:underline">
                      {r.username}
                    </Link>
                    <div className="shrink-0 text-sm font-bold tabular-nums">{r.total}</div>
                  </div>
                  <div className="mt-1.5">
                    <BreakdownBar group={r.group_points} ranking={r.ranking_points} knockout={r.knockout_points} max={maxTotal} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs opacity-60">
                    <span>
                      <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 align-middle" /> {r.group_points} group
                    </span>
                    <span>
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" /> {r.ranking_points} rank
                    </span>
                    <span>
                      <span className="inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" /> {r.knockout_points} KO
                    </span>
                    {r.champion_correct === 1 && <span>🏆 champion</span>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* ── The race ── */}
      <Section title="The race" subtitle="Cumulative score after each phase. Where the lead changed hands.">
        <Card>
          <Timeline timeline={global.timeline} />
        </Card>
        <div className="mt-3 flex flex-wrap gap-2">
          {global.timeline.leadChanges.map((lc, i) => (
            <Pill key={i}>
              <span className="opacity-60">{lc.checkpoint}:</span>
              <span className="font-semibold" style={{ color: colorFor[lc.leader] }}>
                {lc.leader}
              </span>
              {lc.from && <span className="opacity-50">takes the lead</span>}
            </Pill>
          ))}
        </div>
      </Section>

      {/* ── Awards ── */}
      <Section title="The awards" subtitle="One superlative per category — with the number behind it.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {global.awards.map((a) => (
            <Card key={a.key} className="flex items-start gap-3">
              <div className="text-2xl">{a.emoji}</div>
              <div className="min-w-0">
                <div className="text-sm font-bold">{a.title}</div>
                <div className="text-xs opacity-60">{a.blurb}</div>
                <div className="mt-1 text-sm">
                  <span className="font-semibold" style={{ color: colorFor[a.winner] }}>
                    {a.winner}
                  </span>{" "}
                  <span className="opacity-60">· {a.value}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ── Agreement ── */}
      <Section title="Great minds (dis)agree" subtitle="Identical group scorelines predicted, out of 72.">
        <Card>
          <AgreementHeatmap matrix={global.agreementMatrix} />
        </Card>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {global.mostSimilarPair && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Twin brains</div>
              <div className="mt-1 text-sm">
                <strong>{global.mostSimilarPair.a}</strong> & <strong>{global.mostSimilarPair.b}</strong> —{" "}
                {global.mostSimilarPair.identicalScorelines}/72 identical
                {global.mostSimilarPair.sameChampion && " (same champion pick)"}
              </div>
            </Card>
          )}
          {global.mostDifferentPair && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Polar opposites</div>
              <div className="mt-1 text-sm">
                <strong>{global.mostDifferentPair.a}</strong> & <strong>{global.mostDifferentPair.b}</strong> — only{" "}
                {global.mostDifferentPair.identicalScorelines}/72 identical
              </div>
            </Card>
          )}
        </div>
      </Section>

      {/* ── Teams: hard vs easy ── */}
      <Section title="Hardest & easiest teams to read" subtitle="Average scoreline error across all five predictors.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-500">Hardest</div>
            <ul className="space-y-1.5 text-sm">
              {global.hardestTeams.map((t) => (
                <li key={t.team} className="flex items-center justify-between gap-2">
                  <span>
                    {t.team} <span className="opacity-40">({t.group})</span>
                  </span>
                  <span className="tabular-nums opacity-60">{t.avgGoalError.toFixed(2)} err</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-500">Easiest</div>
            <ul className="space-y-1.5 text-sm">
              {global.easiestTeams.map((t) => (
                <li key={t.team} className="flex items-center justify-between gap-2">
                  <span>
                    {t.team} <span className="opacity-40">({t.group})</span>
                  </span>
                  <span className="tabular-nums opacity-60">{t.avgGoalError.toFixed(2)} err</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      {/* ── Over / underrated ── */}
      <Section title="Overrated & underrated" subtitle="Where the pool's expected depth missed the real run.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">Pool overrated 📉</div>
            <ul className="space-y-1.5 text-sm">
              {global.mostOverrated.map((t) => (
                <li key={t.team} className="flex items-center justify-between gap-2">
                  <span>{t.team}</span>
                  <span className="text-xs opacity-60">
                    backed to {DEPTH_LABEL[Math.round(t.predictedDepth)]}, out at {DEPTH_LABEL[t.actualDepth]}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">Pool underrated 📈</div>
            <ul className="space-y-1.5 text-sm">
              {global.mostUnderrated.map((t) => (
                <li key={t.team} className="flex items-center justify-between gap-2">
                  <span>{t.team}</span>
                  <span className="text-xs opacity-60">
                    reached {DEPTH_LABEL[t.actualDepth]}, backed to {DEPTH_LABEL[Math.round(t.predictedDepth)]}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      {/* ── Wisdom & folly of the five ── */}
      <Section title="Wisdom & folly of the five" subtitle="Games where all five agreed — for better or worse.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-500">
              Unanimous & right ({global.collectiveTriumphs.length})
            </div>
            {global.collectiveTriumphs.length === 0 ? (
              <p className="text-sm opacity-50">Never all correct at once.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {global.collectiveTriumphs.slice(0, 8).map((m) => (
                  <li key={m.matchNo} className="flex justify-between gap-2">
                    <span className="truncate">
                      {m.home} v {m.away}
                    </span>
                    <Score h={m.actualHome} a={m.actualAway} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-500">
              Collective blind spots ({global.collectiveBlunders.length})
            </div>
            {global.collectiveBlunders.length === 0 ? (
              <p className="text-sm opacity-50">Someone always saw it coming.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {global.collectiveBlunders.slice(0, 8).map((m) => (
                  <li key={m.matchNo} className="flex justify-between gap-2">
                    <span className="truncate">
                      {m.home} v {m.away}
                    </span>
                    <Score h={m.actualHome} a={m.actualAway} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {global.biggestShock && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Biggest shock 😱</div>
              <div className="mt-1 text-sm font-medium">
                {global.biggestShock.home} <Score h={global.biggestShock.actualHome} a={global.biggestShock.actualAway} />{" "}
                {global.biggestShock.away}
              </div>
            </Card>
          )}
          {global.mostPredictable && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Most predictable 🥱</div>
              <div className="mt-1 text-sm font-medium">
                {global.mostPredictable.home}{" "}
                <Score h={global.mostPredictable.actualHome} a={global.mostPredictable.actualAway} /> {global.mostPredictable.away}
              </div>
            </Card>
          )}
          {global.singleGameHero && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Single-game hero 🦸</div>
              <div className="mt-1 text-sm">
                <span className="font-semibold" style={{ color: colorFor[global.singleGameHero.username] }}>
                  {global.singleGameHero.username}
                </span>{" "}
                <span className="opacity-60">
                  called {global.singleGameHero.game.home} <Score h={global.singleGameHero.game.predHome} a={global.singleGameHero.game.predAway} />{" "}
                  {global.singleGameHero.game.away} ({global.singleGameHero.game.points} pts)
                </span>
              </div>
            </Card>
          )}
        </div>
      </Section>

      {/* ── Fun facts ── */}
      <Section title="By the numbers">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Goals (group)" value={meta.groupGoals} hint={`${meta.groupGoalsPerGame.toFixed(2)}/game`} />
          <Stat label="Draws" value={meta.groupDraws} hint="of 72 group games" />
          <Stat label="Home / away" value={`${meta.groupHomeWins}/${meta.groupAwayWins}`} hint="group wins" />
          <Stat
            label="Pool goal forecast"
            value={Math.round(global.goals.poolPredictedTotal / meta.playerCount)}
            hint="avg predicted / player"
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <div className="text-xs uppercase tracking-wide opacity-50">Champion picks</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {global.championPicks.map((c) => (
                <Pill key={c.username} className={c.correct ? "border-emerald-500/40" : ""}>
                  <span className="opacity-60">{c.username}:</span>
                  <span className="font-semibold">{c.pick}</span>
                  {c.correct && <span>✓</span>}
                </Pill>
              ))}
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide opacity-50">Goals: optimist vs pragmatist</div>
            <div className="mt-1 text-sm">
              📈 <strong>{global.goals.biggestOptimist.username}</strong> ({global.goals.biggestOptimist.perGame.toFixed(2)}/g) ·{" "}
              📉 <strong>{global.goals.biggestPragmatist.username}</strong> ({global.goals.biggestPragmatist.perGame.toFixed(2)}/g)
            </div>
            <div className="mt-1 text-xs opacity-50">Reality: {global.goals.perGame.toFixed(2)} goals/game</div>
          </Card>
        </div>
      </Section>

      {/* ── Personal cards ── */}
      <Section title="Everyone's Wrapped" subtitle="Tap a name for their personal story.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {users.map((u) => (
            <Link
              key={u.entryId}
              href={`/wrapped/${u.slug}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-black/10 p-3 transition-colors hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{u.persona.emoji}</span>
                <div>
                  <div className="font-semibold" style={{ color: colorFor[u.username] }}>
                    {u.username}
                  </div>
                  <div className="text-xs opacity-50">{u.persona.name}</div>
                </div>
              </div>
              <div className="text-right text-xs opacity-60">
                #{u.rank} · {u.total} pts →
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <footer className="mt-16 border-t border-black/10 pt-6 text-xs opacity-40 dark:border-white/15">
        <p>
          Totals come from the live scoring leaderboard. Fun-accuracy stats (exacts, biases) count all 72 group games; the
          official score excludes games {meta.ineligibleGroupMatchNos[0]}–
          {meta.ineligibleGroupMatchNos[meta.ineligibleGroupMatchNos.length - 1]}, which had kicked off before everyone
          submitted. Generated {new Date(meta.generatedAt).toISOString().slice(0, 10)}.
        </p>
        <p className="mt-2">
          <Link href="/" className="underline">
            ← Back to the leaderboard
          </Link>
        </p>
      </footer>
    </main>
  );
}
