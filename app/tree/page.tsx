import { KNOCKOUT_ROUNDS } from "@/lib/deriveBracket";
import {
  getActualKnockoutMatches,
  getActualAdvancers,
  type ActualKnockoutRow,
} from "@/lib/adminData";

export const dynamic = "force-dynamic";

/** Which side won, once the game is decided (penalty winner breaks a level score). */
function winnerSide(m: ActualKnockoutRow): "home" | "away" | null {
  if (m.home_goals === null || m.away_goals === null) return null;
  if (m.home_goals > m.away_goals) return "home";
  if (m.away_goals > m.home_goals) return "away";
  if (m.penalty_winner && m.penalty_winner === m.home_team) return "home";
  if (m.penalty_winner && m.penalty_winner === m.away_team) return "away";
  return null;
}

/**
 * /tree — the live tournament bracket. Renders the real knockout matchups and
 * scores from actual_knockout_matches (populated by the results sync once the
 * group stage ends), round by round, ending at the champion. Read-only.
 */
export default async function TreePage() {
  let rows: ActualKnockoutRow[] = [];
  let champion = "";
  let failed = false;
  try {
    const [ko, advancers] = await Promise.all([getActualKnockoutMatches(), getActualAdvancers()]);
    rows = ko;
    champion = advancers.CHAMPION[0] ?? "";
  } catch (err) {
    console.error("Tree page load failed:", err);
    failed = true;
  }

  const byNo = new Map(rows.map((m) => [m.match_no, m]));
  const anyMatchup = rows.some((m) => m.home_team && m.away_team);

  if (failed) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">Tournament bracket</h1>
        <p className="mt-3 text-sm opacity-70">
          The bracket is temporarily unavailable. Please try again in a moment.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">Tournament bracket</h1>
      <p className="mt-1 text-sm opacity-60">
        The real knockout bracket, updated automatically as results come in.
      </p>

      {!anyMatchup ? (
        <div className="mt-8 rounded-lg border border-black/10 p-6 text-center text-sm opacity-70 dark:border-white/15">
          The bracket appears here once the group stage finishes and the Round of 32 is set.
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto pb-4">
          <div className="flex gap-4">
            {KNOCKOUT_ROUNDS.map((round) => (
              <div key={round.round} className="w-56 shrink-0">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                  {round.label}
                </h2>
                <div className="space-y-2">
                  {round.matches.map((no) => (
                    <MatchCard key={no} match={byNo.get(no)} />
                  ))}
                </div>
              </div>
            ))}
            <div className="w-56 shrink-0">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">Champion</h2>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-4 text-center">
                <div className="text-lg">🏆</div>
                <div className="mt-1 truncate text-sm font-bold">{champion || "TBD"}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function MatchCard({ match }: { match: ActualKnockoutRow | undefined }) {
  if (!match || !match.home_team || !match.away_team) {
    return (
      <div className="rounded-lg border border-dashed border-black/15 px-3 py-3 text-center text-[11px] opacity-40 dark:border-white/20">
        TBD
      </div>
    );
  }
  const w = winnerSide(match);
  return (
    <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/15">
      <TeamRow name={match.home_team} goals={match.home_goals} won={w === "home"} />
      <div className="h-px bg-black/10 dark:bg-white/15" />
      <TeamRow name={match.away_team} goals={match.away_goals} won={w === "away"} />
      {w !== null && match.home_goals === match.away_goals && match.penalty_winner && (
        <div className="bg-black/[0.03] px-2 py-1 text-center text-[10px] opacity-60 dark:bg-white/[0.04]">
          {match.penalty_winner} on penalties
        </div>
      )}
    </div>
  );
}

function TeamRow({ name, goals, won }: { name: string; goals: number | null; won: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${
        won ? "font-bold" : "opacity-80"
      }`}
    >
      <span className="truncate">{name}</span>
      <span className="shrink-0 tabular-nums">{goals ?? ""}</span>
    </div>
  );
}
