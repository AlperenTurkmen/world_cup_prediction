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
    return <UploadForm googleEmail={null} />;
  }

  return <UploadForm googleEmail={googleIdentity.email} />;
}
