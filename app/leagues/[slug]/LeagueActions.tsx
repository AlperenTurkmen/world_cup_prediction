"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PendingReq {
  entryId: number;
  username: string;
}
interface Member {
  entryId: number;
  username: string;
}

interface LeagueActionsProps {
  slug: string;
  isOwner: boolean;
  joinCode: string | null;
  canLeave: boolean;
  pending: PendingReq[];
  members: Member[];
}

export default function LeagueActions({
  slug,
  isOwner,
  joinCode,
  canLeave,
  pending,
  members,
}: LeagueActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl =
    joinCode && typeof window !== "undefined"
      ? `${window.location.origin}/leagues/join?code=${joinCode}`
      : null;

  async function memberAction(action: string, entryId?: number) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/leagues/${slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, entryId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Action failed.");
        return;
      }
      if (action === "leave") {
        router.push("/leagues");
      } else {
        router.refresh();
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteLeague() {
    if (!confirm("Delete this league for everyone? This cannot be undone.")) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/leagues/${slug}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not delete league.");
        return;
      }
      router.push("/leagues");
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function copyShare() {
    if (!joinCode) return;
    const text = shareUrl ?? joinCode;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the code is shown inline anyway */
    }
  }

  if (!isOwner && !canLeave) return null;

  return (
    <div className="mt-6 space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Owner: share link */}
      {isOwner && joinCode && (
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
          <h3 className="text-sm font-semibold">Invite link</h3>
          <p className="mt-1 break-all text-xs opacity-70">{shareUrl ?? joinCode}</p>
          <button
            type="button"
            onClick={copyShare}
            className="mt-2 rounded-md border border-black/20 px-3 py-1 text-xs font-medium dark:border-white/25"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      )}

      {/* Owner: pending requests */}
      {isOwner && pending.length > 0 && (
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
          <h3 className="text-sm font-semibold">
            Join requests ({pending.length})
          </h3>
          <ul className="mt-2 divide-y divide-black/5 dark:divide-white/10">
            {pending.map((p) => (
              <li key={p.entryId} className="flex items-center justify-between py-2 text-sm">
                <span>{p.username}</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => memberAction("approve", p.entryId)}
                    className="rounded-md bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => memberAction("deny", p.entryId)}
                    className="rounded-md border border-black/20 px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-white/25"
                  >
                    Deny
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Owner: manage members */}
      {isOwner && members.length > 0 && (
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
          <h3 className="text-sm font-semibold">Members</h3>
          <ul className="mt-2 divide-y divide-black/5 dark:divide-white/10">
            {members.map((m) => (
              <li key={m.entryId} className="flex items-center justify-between py-2 text-sm">
                <span>{m.username}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => memberAction("remove", m.entryId)}
                  className="text-xs font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Owner: delete league */}
      {isOwner && (
        <button
          type="button"
          disabled={busy}
          onClick={deleteLeague}
          className="text-sm font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
        >
          Delete league
        </button>
      )}

      {/* Member: leave */}
      {canLeave && (
        <button
          type="button"
          disabled={busy}
          onClick={() => memberAction("leave")}
          className="text-sm font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
        >
          Leave league
        </button>
      )}
    </div>
  );
}
