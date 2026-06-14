import Link from "next/link";
import { getPendingGoogleIdentity, sanitizeRedirectTo } from "@/lib/googleAuth";
import LinkGoogleForm from "./LinkGoogleForm";

interface LinkPageProps {
  searchParams: Promise<{
    redirectTo?: string;
  }>;
}

export default async function LinkGooglePage({ searchParams }: LinkPageProps) {
  const params = await searchParams;
  const identity = await getPendingGoogleIdentity();
  const redirectTo = sanitizeRedirectTo(params.redirectTo);

  if (!identity) {
    return (
      <main className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-black/15 bg-white p-8 shadow-xl dark:border-white/10 dark:bg-[#111111]">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Google session expired</h1>
          <p className="mt-2 text-sm text-foreground/60">
            Please continue with Google again before linking or uploading predictions.
          </p>
          <Link
            href={`/api/auth/google/start?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="mt-6 inline-flex w-full justify-center rounded-lg bg-foreground py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-95"
          >
            Continue with Google
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-12">
      <LinkGoogleForm email={identity.email} redirectTo={redirectTo} />
    </main>
  );
}
