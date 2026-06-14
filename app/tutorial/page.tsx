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
  "Exact group-stage score: 3 points",
  "Correct group-stage result: 1 point",
  "Knockout rounds: points for each team you correctly predicted to advance",
  "Champion pick: the biggest knockout bonus",
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
          You score from group match predictions and from teams you correctly send through
          the knockout bracket. The leaderboard updates as real results are entered.
        </p>
        <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {scoringItems.map((item) => (
            <li key={item} className="rounded-md bg-black/[0.04] px-3 py-2 dark:bg-white/10">
              {item}
            </li>
          ))}
        </ul>
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
