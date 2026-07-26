import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { wrapped, userBySlug, colorFor, DEPTH_LABEL, ordinal, MEDALS } from "../shared";
import { Section, Card, Stat, BreakdownBar, Pill, Score } from "../ui";
import Timeline from "../Timeline";
import ShareCard from "./ShareCard";

// Frozen dataset → statically prerender each player's page at build time.
export const dynamic = "force-static";

export function generateStaticParams() {
  return wrapped.users.map((u) => ({ slug: u.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const u = userBySlug(slug);
  if (!u) return { title: "Wrapped" };
  return {
    title: `${u.username} — World Cup 2026 Wrapped`,
    description: `${u.persona.name}: #${u.rank} of 5 with ${u.total} points.`,
  };
}

const PHASE_COLOR: Record<string, string> = {
  Groups: "bg-indigo-500",
  R32: "bg-sky-500",
  R16: "bg-teal-500",
  QF: "bg-emerald-500",
  SF: "bg-amber-500",
  Final: "bg-rose-500",
};

export default async function PersonalWrappedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const u = userBySlug(slug);
  if (!u) notFound();

  const color = colorFor[u.username];
  const others = wrapped.users.filter((x) => x.entryId !== u.entryId);
  const maxTotal = Math.max(...wrapped.users.map((x) => x.total), 1);
  const maxPhase = Math.max(...u.phasePoints.map((p) => p.points), 1);
  const goalDelta = u.goalsPerGame - wrapped.meta.groupGoalsPerGame;
  const peakRank = Math.min(...u.rankAt);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      {/* ── Hero ── */}
      <div className="mb-6 flex items-center justify-between text-sm">
        <Link href="/wrapped" className="opacity-60 hover:underline">
          ← All Wrapped
        </Link>
        <span className="opacity-40">{ordinal(u.rank)} of {wrapped.users.length}</span>
      </div>

      <header
        className="rounded-2xl border p-6 text-center"
        style={{ borderColor: color + "55", background: `linear-gradient(180deg, ${color}18, transparent)` }}
      >
        <div className="text-4xl">{u.persona.emoji}</div>
        <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl" style={{ color }}>
          {u.username}
        </h1>
        <div className="mt-1 text-sm font-semibold uppercase tracking-wide opacity-70">{u.persona.name}</div>
        <p className="mx-auto mt-2 max-w-sm text-sm opacity-60">{u.persona.scoutingReport}</p>
        <div className="mt-4 flex items-center justify-center gap-6">
          <div>
            <div className="text-3xl font-black tabular-nums">{u.total}</div>
            <div className="text-xs uppercase tracking-wide opacity-50">points</div>
          </div>
          <div>
            <div className="text-3xl font-black tabular-nums">
              {u.rank <= 3 ? MEDALS[u.rank - 1] : `#${u.rank}`}
            </div>
            <div className="text-xs uppercase tracking-wide opacity-50">finish</div>
          </div>
          <div>
            <div className="text-3xl font-black tabular-nums">{u.exactCountRaw}</div>
            <div className="text-xs uppercase tracking-wide opacity-50">exacts</div>
          </div>
        </div>
      </header>

      {/* ── Points breakdown ── */}
      <Section title="Where your points came from">
        <Card>
          <BreakdownBar group={u.groupPoints} ranking={u.rankingPoints} knockout={u.knockoutPoints} max={maxTotal} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Group" value={u.groupPoints} />
            <Stat label="Ranking" value={u.rankingPoints} />
            <Stat label="Knockout" value={u.knockoutPoints} />
          </div>
          <p className="mt-3 text-sm opacity-70">
            Your best phase was <strong>{u.bestPhase}</strong>.
          </p>
          <div className="mt-2 flex items-end gap-1.5" style={{ height: 60 }}>
            {u.phasePoints.map((p) => (
              <div key={p.phase} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div
                  className={`w-full rounded-t ${PHASE_COLOR[p.phase] ?? "bg-black/30"}`}
                  style={{ height: `${(100 * p.points) / maxPhase}%`, minHeight: p.points > 0 ? 3 : 0 }}
                  title={`${p.phase}: ${p.points}`}
                />
                <div className="text-[10px] opacity-50">{p.phase}</div>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* ── Signature moments ── */}
      <Section title="Your signature moments">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <div className="text-xs uppercase tracking-wide opacity-50">Best single call 🎯</div>
            <div className="mt-1 text-sm">
              {u.bestGame.home} <Score h={u.bestGame.predHome} a={u.bestGame.predAway} /> {u.bestGame.away}
            </div>
            <div className="mt-0.5 text-xs opacity-60">
              actual {u.bestGame.actualHome}–{u.bestGame.actualAway} · {u.bestGame.points} pts
              {u.bestGame.isExact && " · exact ✨"}
            </div>
          </Card>
          {u.bestSoloCall ? (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Only you saw it 🃏</div>
              <div className="mt-1 text-sm">
                {u.bestSoloCall.home} <Score h={u.bestSoloCall.predHome} a={u.bestSoloCall.predAway} /> {u.bestSoloCall.away}
              </div>
              <div className="mt-0.5 text-xs opacity-60">
                {u.soloCorrectCount} call{u.soloCorrectCount === 1 ? "" : "s"} nobody else got right
              </div>
            </Card>
          ) : (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Contrarian streak 🃏</div>
              <div className="mt-1 text-sm opacity-70">
                Went against the pool majority <strong>{u.maverickScore}</strong> times.
              </div>
            </Card>
          )}
          <Card>
            <div className="text-xs uppercase tracking-wide opacity-50">Biggest whiff 😬</div>
            <div className="mt-1 text-sm">
              {u.worstGame.home} <Score h={u.worstGame.predHome} a={u.worstGame.predAway} /> {u.worstGame.away}
            </div>
            <div className="mt-0.5 text-xs opacity-60">
              actually ended {u.worstGame.actualHome}–{u.worstGame.actualAway}
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide opacity-50">Near-miss tax 😖</div>
            <div className="mt-1 text-2xl font-black tabular-nums">{u.nearMissCount}</div>
            <div className="text-xs opacity-60">scores one goal from perfect</div>
          </Card>
        </div>
      </Section>

      {/* ── Tendencies ── */}
      <Section title="Your tendencies">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Goals / game"
            value={u.goalsPerGame.toFixed(2)}
            hint={`${goalDelta >= 0 ? "+" : ""}${goalDelta.toFixed(2)} vs reality`}
          />
          <Stat label="Draws called" value={u.drawsPredicted} hint={`of ${wrapped.meta.groupDraws} real`} />
          <Stat label="Home bias" value={`${u.homeBias >= 0 ? "+" : ""}${u.homeBias.toFixed(2)}`} hint="avg home − away" />
          <Stat
            label="Comfort score"
            value={u.favoriteScoreline.score.replace("-", "–")}
            hint={`used ${u.favoriteScoreline.count}× · hit ${u.favoriteScoreline.landed}`}
          />
        </div>
        <p className="mt-3 text-sm opacity-70">
          You went against the crowd <strong>{u.maverickScore}/72</strong> times and nailed{" "}
          <strong>{u.outcomeHits}/72</strong> match outcomes.
        </p>
      </Section>

      {/* ── Knockouts & champion ── */}
      <Section title="Your knockouts">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <div className="text-xs uppercase tracking-wide opacity-50">Champion pick 🏆</div>
            <div className="mt-1 text-lg font-bold">
              {u.championPick} {u.championCorrect && <span className="text-emerald-500">✓</span>}
            </div>
            <div className="text-xs opacity-60">
              {u.championCorrect
                ? "You called the champion."
                : `They reached the ${DEPTH_LABEL[u.championJourneyRounds]} — you rode with them ${u.championJourneyRounds} round${u.championJourneyRounds === 1 ? "" : "s"}.`}
            </div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide opacity-50">Bracket survival 🏰</div>
            <div className="mt-1 text-sm">
              QF <strong>{u.bracketSurvival.qf}</strong> · SF <strong>{u.bracketSurvival.sf}</strong> · Finalists{" "}
              <strong>{u.bracketSurvival.finalists}</strong>
            </div>
            <div className="text-xs opacity-60">correctly predicted advancers by round</div>
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide opacity-50">The second tour 🔁</div>
            {u.tourGamesPlayed > 0 ? (
              <div className="mt-1 text-sm">
                <strong>{u.tourPoints}</strong> pts over {u.tourGamesPlayed} real knockout games ({u.tourExacts} exact
                {u.tourExacts === 1 ? "" : "s"}
                {u.penaltyProphet > 0 && `, ${u.penaltyProphet} shoot-out${u.penaltyProphet === 1 ? "" : "s"} called`}).
              </div>
            ) : (
              <div className="mt-1 text-sm opacity-70">Sat out the knockout tours — advancement points only.</div>
            )}
            {u.foresightPoints > 0 && (
              <div className="mt-1 text-xs text-fuchsia-500">🔮 +{u.foresightPoints} foresight bonus (called it blind).</div>
            )}
          </Card>
          <Card>
            <div className="text-xs uppercase tracking-wide opacity-50">Table reading 🧮</div>
            <div className="mt-1 text-sm">
              <strong>{u.rankExact}</strong>/48 exact group finishes, {u.rankAdjacent} one-off.
            </div>
          </Card>
        </div>
      </Section>

      {/* ── Teams ── */}
      <Section title="Teams & groups">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {u.mvpTeam && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Your MVP ⭐</div>
              <div className="mt-1 text-sm font-semibold">{u.mvpTeam.team}</div>
              <div className="text-xs opacity-60">{u.mvpTeam.points} pts earned</div>
            </Card>
          )}
          {u.believedIn && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Went all-in on 💫</div>
              <div className="mt-1 text-sm font-semibold">{u.believedIn}</div>
              <div className="text-xs opacity-60">your champion pick</div>
            </Card>
          )}
          {u.kryptoniteGroup && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Kryptonite 🪨</div>
              <div className="mt-1 text-sm font-semibold">Group {u.kryptoniteGroup.group}</div>
              <div className="text-xs opacity-60">only {u.kryptoniteGroup.points} pts</div>
            </Card>
          )}
        </div>
      </Section>

      {/* ── Social ── */}
      <Section title="You vs the group">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {u.twin && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Twin brain 🧠</div>
              <div className="mt-1 text-sm font-semibold" style={{ color: colorFor[u.twin.username] }}>
                {u.twin.username}
              </div>
              <div className="text-xs opacity-60">{u.twin.identical}/72 identical scorelines</div>
            </Card>
          )}
          {u.opposite && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Polar opposite ↔️</div>
              <div className="mt-1 text-sm font-semibold" style={{ color: colorFor[u.opposite.username] }}>
                {u.opposite.username}
              </div>
              <div className="text-xs opacity-60">only {u.opposite.identical}/72 alike</div>
            </Card>
          )}
          {u.closestRival && (
            <Card>
              <div className="text-xs uppercase tracking-wide opacity-50">Closest rival 🥊</div>
              <div className="mt-1 text-sm font-semibold" style={{ color: colorFor[u.closestRival.username] }}>
                {u.closestRival.username}
              </div>
              <div className="text-xs opacity-60">{u.closestRival.margin} pts apart</div>
            </Card>
          )}
        </div>

        <Card className="mt-3">
          <div className="mb-2 text-xs uppercase tracking-wide opacity-50">Head-to-head (72 group games)</div>
          <div className="space-y-1.5">
            {u.headToHead.map((h) => {
              const total = h.wins + h.losses + h.ties || 1;
              return (
                <div key={h.username} className="flex items-center gap-2 text-sm">
                  <div className="w-28 shrink-0 truncate" style={{ color: colorFor[h.username] }}>
                    {h.username}
                  </div>
                  <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                    <div className="bg-emerald-500" style={{ width: `${(100 * h.wins) / total}%` }} />
                    <div className="bg-black/15 dark:bg-white/20" style={{ width: `${(100 * h.ties) / total}%` }} />
                    <div className="bg-rose-500" style={{ width: `${(100 * h.losses) / total}%` }} />
                  </div>
                  <div className="w-24 shrink-0 text-right text-xs tabular-nums opacity-60">
                    {h.wins}W {h.ties}D {h.losses}L
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] opacity-40">Green = you scored more on that game; red = they did.</div>
        </Card>
      </Section>

      {/* ── Your race ── */}
      <Section title="Your race" subtitle={`Peaked at ${ordinal(peakRank)}. Finished ${ordinal(u.rank)}.`}>
        <Card>
          <Timeline timeline={wrapped.global.timeline} highlight={u.username} />
        </Card>
        <div className="mt-2 text-sm opacity-70">
          Submitted {new Date(u.submittedAt).toISOString().slice(0, 10)} — {ordinal(u.submissionRank)} of{" "}
          {wrapped.users.length} to lock in.
        </div>
      </Section>

      {/* ── Share ── */}
      <Section title="Share your Wrapped">
        <ShareCard
          username={u.username}
          persona={`${u.persona.emoji} ${u.persona.name}`}
          rank={u.rank}
          playerCount={wrapped.users.length}
          total={u.total}
          exacts={u.exactCountRaw}
          championPick={u.championPick}
          championCorrect={u.championCorrect}
          color={color}
          twin={u.twin?.username ?? null}
        />
      </Section>

      {/* ── Other players ── */}
      <Section title="See another Wrapped">
        <div className="flex flex-wrap gap-2">
          {others.map((o) => (
            <Link
              key={o.entryId}
              href={`/wrapped/${o.slug}`}
              className="rounded-full border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.05]"
            >
              {o.persona.emoji} <span style={{ color: colorFor[o.username] }}>{o.username}</span>
            </Link>
          ))}
        </div>
      </Section>

      <footer className="mt-14 border-t border-black/10 pt-6 text-xs opacity-40 dark:border-white/15">
        <Pill>#{u.rank} of {wrapped.users.length}</Pill>{" "}
        <Link href="/wrapped" className="underline">
          Back to the global Wrapped →
        </Link>
      </footer>
    </main>
  );
}
