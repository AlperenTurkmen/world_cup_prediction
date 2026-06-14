import Link from "next/link";
import { getPendingGoogleIdentity } from "@/lib/googleAuth";
import { getCurrentPlayer } from "@/lib/playerAuth";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const [player, googleIdentity] = await Promise.all([
    getCurrentPlayer(),
    getPendingGoogleIdentity(),
  ]);

  if (player) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">You already have an entry</h1>
        <p className="mt-2 text-sm opacity-70">
          You are signed in as <strong>{player.username}</strong>. Each username can upload
          predictions once, and entries are immutable.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link
            href={`/user/${encodeURIComponent(player.username)}`}
            className="rounded-md bg-foreground px-4 py-2 font-medium text-background"
          >
            View my profile
          </Link>
          <Link href="/" className="rounded-md border border-black/15 px-4 py-2 font-medium dark:border-white/20">
            Leaderboard
          </Link>
        </div>
      </main>
    );
  }

  if (!googleIdentity) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">Upload your predictions</h1>
        <p className="mt-2 text-sm opacity-70">
          Sign in with Google first, then upload your filled WCup_2026 Excel workbook.
          Your Google account will be linked to the new prediction entry.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/api/auth/google/start?redirectTo=%2Fupload"
            className="inline-flex justify-center rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-95"
          >
            Continue with Google
          </Link>
          <Link
            href="/login"
            className="inline-flex justify-center rounded-md border border-black/15 px-5 py-2.5 text-sm font-medium dark:border-white/20"
          >
            Log in to an existing entry
          </Link>
          <Link
            href="/tutorial"
            className="inline-flex justify-center rounded-md border border-black/15 px-5 py-2.5 text-sm font-medium dark:border-white/20"
          >
            How it works
          </Link>
        </div>
      </main>
    );
  }

  return <UploadForm googleEmail={googleIdentity.email} />;
}
