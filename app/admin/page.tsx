import { isAdminAuthenticated } from "@/lib/adminAuth";
import {
  getMatches,
  getCanonicalTeams,
  getActualAdvancers,
  getAdminEntries,
  getAdminLeagues,
} from "@/lib/adminData";
import LoginForm from "./LoginForm";
import LogoutButton from "./LogoutButton";
import ResultsUpload from "./ResultsUpload";
import GroupResults from "./GroupResults";
import Advancers from "./Advancers";
import Moderation from "./Moderation";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authed = await isAdminAuthenticated();

  if (!authed) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="mt-2 text-sm opacity-70">Sign in to enter results.</p>
        <LoginForm />
      </main>
    );
  }

  // Authenticated — load the data the forms need.
  let matches, teams, advancers, entries, leagues, loadError: string | null = null;
  try {
    [matches, teams, advancers, entries, leagues] = await Promise.all([
      getMatches(),
      getCanonicalTeams(),
      getActualAdvancers(),
      getAdminEntries(),
      getAdminLeagues(),
    ]);
  } catch (err) {
    console.error("admin data load failed:", err);
    loadError = "Could not load data from the database.";
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold">Admin · results entry</h1>
        <LogoutButton />
      </div>

      {loadError ? (
        <div className="mt-8 rounded-md border border-red-600/30 bg-red-600/10 p-4 text-sm text-red-700 dark:text-red-300">
          {loadError}
        </div>
      ) : !matches || matches.length === 0 ? (
        <div className="mt-8 rounded-md border border-black/10 p-4 text-sm opacity-70 dark:border-white/15">
          No fixtures found. Seed the 72 group matches first (<code>npm run seed</code>),
          then reload.
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <Moderation entries={entries ?? []} leagues={leagues ?? []} />
          <ResultsUpload />
          <GroupResults matches={matches} />
          <Advancers teams={teams ?? []} initial={advancers!} />
        </div>
      )}
    </main>
  );
}
