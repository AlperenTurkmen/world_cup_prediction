/**
 * ScoringInfo — the "how scoring works" guide shown under the leaderboard.
 *
 * Presentational server component. The weights are passed in (read live from
 * `scoring_weights` / `round_weights` by the page) so this guide always matches
 * the values the leaderboard view actually uses — tune the weights and the
 * guide follows. Full model: docs/SCORING_DESIGN.md.
 */

export interface ScoringWeights {
  W_OUTCOME: number;
  W_GOALDIFF: number;
  W_TEAMGOALS: number;
  W_EXACT: number;
  W_RANK_EXACT: number;
  W_RANK_ADJACENT: number;
}

export interface RoundWeights {
  R32: number;
  R16: number;
  QF: number;
  SF: number;
  FINAL: number;
  CHAMPION: number;
}

/** Defaults mirror db/schema.sql; used if the weight tables can't be read. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  W_OUTCOME: 2,
  W_GOALDIFF: 1,
  W_TEAMGOALS: 1,
  W_EXACT: 3,
  W_RANK_EXACT: 3,
  W_RANK_ADJACENT: 1,
};

export const DEFAULT_ROUND_WEIGHTS: RoundWeights = {
  R32: 1,
  R16: 2,
  QF: 4,
  SF: 6,
  FINAL: 8,
  CHAMPION: 12,
};

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-black/[0.06] text-xs font-semibold tabular-nums dark:bg-white/10">
      {children}
    </span>
  );
}

function Pts({ children }: { children: string }) {
  return <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{children}</span>;
}

export default function ScoringInfo({
  weights,
  rounds,
}: {
  weights: ScoringWeights;
  rounds: RoundWeights;
}) {
  const maxMatch = weights.W_OUTCOME + weights.W_GOALDIFF + 2 * weights.W_TEAMGOALS + weights.W_EXACT;

  return (
    <details className="group mt-10 rounded-lg border border-black/10 dark:border-white/15" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold">
        <span>How scoring works</span>
        <span className="text-xs font-normal opacity-50 transition-transform group-open:rotate-180">▾</span>
      </summary>

      <div className="space-y-7 border-t border-black/10 px-5 py-5 text-sm dark:border-white/15">
        <p className="opacity-70">
          Every correct insight earns points — the axes <strong>stack</strong>, so you&rsquo;re never penalised for a
          near-miss and precision is rewarded the most.
        </p>

        {/* Dimension A — group match */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Badge>A</Badge>
            <h3 className="font-semibold">Group match</h3>
            <span className="opacity-50">— each of the 72 group games</span>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Correct result (win / draw / loss)</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_OUTCOME}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Correct goal difference</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_GOALDIFF}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Each team&rsquo;s exact goals (up to 2)</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_TEAMGOALS} each`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Exact scoreline (perfect)</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_EXACT}`}</Pts></td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-semibold">Most you can earn on one match</td>
                <td className="py-1.5 text-right"><Pts>{String(maxMatch)}</Pts></td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3 rounded-md bg-black/[0.03] px-3 py-2 text-xs opacity-80 dark:bg-white/[0.04]">
            <span className="font-semibold">Examples</span> (you predict → actual):
            <span className="tabular-nums"> 2–1 → 2–1 = {maxMatch}</span>,
            <span className="tabular-nums"> 2–1 → 3–2 = {weights.W_OUTCOME + weights.W_GOALDIFF}</span> (winner + margin),
            <span className="tabular-nums"> 2–0 → 3–1 = {weights.W_OUTCOME}</span> (winner only),
            <span className="tabular-nums"> 2–1 → 0–2 = 0</span>.
          </div>
        </section>

        {/* Dimension B — group ranking */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Badge>B</Badge>
            <h3 className="font-semibold">Group ranking</h3>
            <span className="opacity-50">— each team&rsquo;s final position in its group</span>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Team finishes in the exact position you predicted</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_RANK_EXACT}`}</Pts></td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3">Team finishes one position off</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_RANK_ADJACENT}`}</Pts></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs opacity-60">
            Your group tables come from your own scorelines — no extra picks. Scored once all 6 of a group&rsquo;s
            games are in. E.g. you predict Germany 3rd and they finish 3rd → +{weights.W_RANK_EXACT}.
          </p>
        </section>

        {/* Dimension C — knockout */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Badge>C</Badge>
            <h3 className="font-semibold">Knockout progression</h3>
            <span className="opacity-50">— per team, each round it reaches</span>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Reaches Round of 32</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.R32}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Reaches Round of 16</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.R16}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Reaches Quarter-final</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.QF}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Reaches Semi-final</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.SF}`}</Pts></td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3">Reaches the Final</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.FINAL}`}</Pts></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs opacity-60">
            Cumulative and forgiving: predict a team to the Semi-final and you bank R32 + R16 + QF + SF as it clears
            each stage. If it goes out early you simply keep what it earned — no points are taken away.
          </p>
        </section>

        {/* Dimension D — champion */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Badge>D</Badge>
            <h3 className="font-semibold">Champion</h3>
            <span className="opacity-50">— one pick, all or nothing</span>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <td className="py-1.5 pr-3">Your predicted winner lifts the trophy</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.CHAMPION}`}</Pts></td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Dimension F — knockout match scores (the tours) */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Badge>F</Badge>
            <h3 className="font-semibold">Knockout match scores</h3>
            <span className="opacity-50">— the per-round prediction tours</span>
          </div>
          <p className="mb-2 text-xs opacity-60">
            Once the group stage ends, each knockout round opens a fresh window: predict the score of
            every <strong>real</strong> matchup. Editable until that round&rsquo;s first game kicks off,
            then the whole round locks. Scored exactly like a group match — the axes stack:
          </p>
          <table className="w-full border-collapse">
            <tbody>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Correct result (win / draw / loss)</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_OUTCOME}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Correct goal difference</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_GOALDIFF}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Each team&rsquo;s exact goals (up to 2)</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_TEAMGOALS} each`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Exact scoreline (perfect)</td>
                <td className="py-1.5 text-right"><Pts>{`+${weights.W_EXACT}`}</Pts></td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-semibold">Most you can earn on one knockout game</td>
                <td className="py-1.5 text-right"><Pts>{String(maxMatch)}</Pts></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs opacity-60">
            Every round is worth the same here — an exact Round-of-32 score and an exact Final score are
            both <Pts>{String(maxMatch)}</Pts>. (The reward for going deep is in the bonus below.)
          </p>
        </section>

        {/* Foresight bonus — repurposed pre-tournament bracket knockout scorelines */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Badge>★</Badge>
            <h3 className="font-semibold">Foresight bonus</h3>
            <span className="opacity-50">— calling a knockout game from the very start</span>
          </div>
          <p className="mb-2 text-xs opacity-60">
            If your original pre-tournament bracket already had a knockout game&rsquo;s{" "}
            <strong>exact two teams and exact score</strong> — foreseen before anyone knew the matchup —
            you earn a bonus on top of the score above. The deeper the round, the bigger it is:
          </p>
          <table className="w-full border-collapse">
            <tbody>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Foreseen a Round-of-32 game</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.R32}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Foreseen a Round-of-16 game</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.R16}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Foreseen a Quarter-final</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.QF}`}</Pts></td>
              </tr>
              <tr className="border-b border-black/5 dark:border-white/10">
                <td className="py-1.5 pr-3">Foreseen a Semi-final</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.SF}`}</Pts></td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3">Foreseen the Final</td>
                <td className="py-1.5 text-right"><Pts>{`+${rounds.FINAL}`}</Pts></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs opacity-60">
            Example: your bracket predicted Brazil 3&ndash;2 Korea in the Round of 32 and that&rsquo;s exactly
            what happens → <Pts>{String(maxMatch)}</Pts> for the score{" "}
            <span className="opacity-70">+</span> <Pts>{`${rounds.R32}`}</Pts> foresight ={" "}
            <Pts>{String(maxMatch + rounds.R32)}</Pts>.
          </p>
        </section>

        <section>
          <h3 className="mb-1 font-semibold">Ties are broken by</h3>
          <ol className="list-inside list-decimal space-y-0.5 opacity-70">
            <li>Highest total score</li>
            <li>Most exact scorelines</li>
            <li>Correct champion</li>
            <li>Earliest submission</li>
          </ol>
        </section>
      </div>
    </details>
  );
}
