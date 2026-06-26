import Link from "next/link";

const uploadSteps = [
  {
    title: "Download and fill the workbook",
    body: "Download Hermann Baum's WCup_2026 Excel file and enter your predicted scores for every group match. The knockout bracket will calculate from those scores.",
  },
  {
    title: "Open and save it once",
    body: "After finishing, open the file in Excel and save it. This makes sure the knockout teams and champion are stored in the workbook before upload.",
  },
  {
    title: "Sign in, choose a username, upload",
    body: "Go to the upload page, sign in with Google, pick your public leaderboard name, and submit the filled .xlsx file.",
  },
];

const scoringItems = [
  "Group match: up to 8 points per game — credit stacks for the result, goal difference, each team's exact goals, and a perfect scoreline.",
  "Group ranking: points for each team's final position in its group (derived from your own scores — no extra picks).",
  "Knockout progression: a team earns more each round it reaches — Round of 32 through the Final, plus a big bonus for the champion.",
  "Knockout tours: when the bracket is set, predict each round's real match scores (up to 8 each), editable until that round's first kickoff.",
  "Foresight bonus: nail a knockout game's exact teams and score in your original bracket and earn a bonus on top — bigger the deeper the round.",
];

export default function TutorialPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide opacity-60">
            Quick guide
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Uploading your predictions
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 opacity-70">
            Fill the official Excel bracket, save it after the bracket calculates, then upload
            it once. Your entry is locked after submission.
          </p>
        </div>
        <Link
          href="/upload"
          className="inline-flex justify-center rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-95"
        >
          Start upload
        </Link>
      </div>

      <section className="mt-8 rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-lg font-semibold">Get the spreadsheet</h2>
        <p className="mt-2 text-sm leading-6 opacity-70">
          Download the official Hermann Baum World Cup 2026 Excel workbook, fill it in,
          then come back here to upload your saved .xlsx file.
        </p>
        <a
          href="https://hermann-baum.de/excel/WorldCup/en/downloads_2026.php"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
        >
          Download Hermann Baum spreadsheet
        </a>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">How to submit</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {uploadSteps.map((step, index) => (
            <article
              key={step.title}
              className="rounded-lg border border-black/10 p-4 dark:border-white/15"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                {index + 1}
              </div>
              <h3 className="mt-4 text-sm font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 opacity-70">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-lg font-semibold">How scoring works</h2>
        <p className="mt-2 text-sm leading-6 opacity-70">
          You score from your group-match predictions, the group standings they imply, the teams you
          send deep into the knockouts, and — once the bracket is set — a fresh round of predicting the
          real knockout scores. The leaderboard updates live as results come in.
        </p>
        <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {scoringItems.map((item) => (
            <li key={item} className="rounded-md bg-black/[0.04] px-3 py-2 dark:bg-white/10">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-6 opacity-70">
          For the exact points on every axis, see the{" "}
          <Link href="/" className="font-medium underline">
            full breakdown under &ldquo;How scoring works&rdquo; on the leaderboard
          </Link>
          .
        </p>
      </section>

      <section className="mt-8 rounded-lg border border-amber-500/30 bg-amber-500/10 p-5">
        <h2 className="text-sm font-semibold">Before you upload</h2>
        <p className="mt-2 text-sm leading-6 opacity-75">
          If the file has blank knockout teams, open it in Excel, save it, and upload again.
          The system reads the saved bracket values from the workbook.
        </p>
      </section>
    </main>
  );
}
