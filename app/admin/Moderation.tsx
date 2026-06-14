"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { AdminEntryRow, AdminLeagueRow } from "@/lib/adminData";

type Target = "entries" | "leagues";

interface RowState {
  busy: boolean;
  error: string | null;
}

function useModeration() {
  const router = useRouter();
  const [states, setStates] = useState<Record<string, RowState>>({});

  function setRowState(key: string, patch: Partial<RowState>) {
    setStates((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { busy: false, error: null }), ...patch },
    }));
  }

  async function updateVisibility(target: Target, id: number, hidden: boolean) {
    const key = `${target}:${id}`;
    setRowState(key, { busy: true, error: null });
    try {
      const res = await fetch(`/api/admin/${target}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, hidden }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRowState(key, { busy: false, error: data?.error ?? "Update failed." });
        return;
      }
      router.refresh();
    } catch {
      setRowState(key, { busy: false, error: "Network error." });
    }
  }

  async function remove(target: Target, id: number, label: string) {
    const confirmed = window.confirm(`Remove ${label}? This permanently deletes it.`);
    if (!confirmed) return;

    const key = `${target}:${id}`;
    setRowState(key, { busy: true, error: null });
    try {
      const res = await fetch(`/api/admin/${target}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRowState(key, { busy: false, error: data?.error ?? "Delete failed." });
        return;
      }
      router.refresh();
    } catch {
      setRowState(key, { busy: false, error: "Network error." });
    }
  }

  return { states, updateVisibility, remove };
}

function StatusBadge({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
      Hidden
    </span>
  ) : (
    <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
      Visible
    </span>
  );
}

function ActionButton({
  children,
  danger = false,
  disabled,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const dangerClass = danger
    ? "border-red-600/30 text-red-700 hover:bg-red-600/10 dark:text-red-300"
    : "border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-40 ${dangerClass}`}
    >
      {children}
    </button>
  );
}

export default function Moderation({
  entries,
  leagues,
}: {
  entries: AdminEntryRow[];
  leagues: AdminLeagueRow[];
}) {
  const { states, updateVisibility, remove } = useModeration();

  return (
    <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-lg font-semibold">Moderation</h2>
      <p className="mt-1 text-sm opacity-70">
        Hide users from leaderboards and profiles, or remove them entirely. Hide
        leagues from league pages, invite links, and public listings.
      </p>

      <div className="mt-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide opacity-60">Users</h3>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm opacity-60">No users yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {entries.map((entry) => {
                  const key = `entries:${entry.id}`;
                  const state = states[key] ?? { busy: false, error: null };
                  return (
                    <tr key={entry.id} className="border-b border-black/5 dark:border-white/10">
                      <td className="py-2 pr-3 font-medium">{entry.username}</td>
                      <td className="py-2 pr-3"><StatusBadge hidden={entry.is_hidden} /></td>
                      <td className="py-2 pr-3 text-xs opacity-60">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap justify-end gap-2">
                          <ActionButton
                            disabled={state.busy}
                            onClick={() => updateVisibility("entries", entry.id, !entry.is_hidden)}
                          >
                            {entry.is_hidden ? "Restore" : "Hide"}
                          </ActionButton>
                          <ActionButton
                            danger
                            disabled={state.busy}
                            onClick={() => remove("entries", entry.id, entry.username)}
                          >
                            Remove
                          </ActionButton>
                        </div>
                        {state.error && (
                          <p className="mt-1 text-right text-xs text-red-700 dark:text-red-300">
                            {state.error}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8">
        <h3 className="text-sm font-semibold uppercase tracking-wide opacity-60">Leagues</h3>
        {leagues.length === 0 ? (
          <p className="mt-2 text-sm opacity-60">No leagues yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {leagues.map((league) => {
                  const key = `leagues:${league.id}`;
                  const state = states[key] ?? { busy: false, error: null };
                  return (
                    <tr key={league.id} className="border-b border-black/5 dark:border-white/10">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{league.name}</div>
                        <div className="text-xs opacity-60">
                          {league.visibility} · owner {league.owner_username} · {league.member_count} members
                        </div>
                      </td>
                      <td className="py-2 pr-3"><StatusBadge hidden={league.is_hidden} /></td>
                      <td className="py-2">
                        <div className="flex flex-wrap justify-end gap-2">
                          <ActionButton
                            disabled={state.busy}
                            onClick={() => updateVisibility("leagues", league.id, !league.is_hidden)}
                          >
                            {league.is_hidden ? "Restore" : "Hide"}
                          </ActionButton>
                          <ActionButton
                            danger
                            disabled={state.busy}
                            onClick={() => remove("leagues", league.id, league.name)}
                          >
                            Remove
                          </ActionButton>
                        </div>
                        {state.error && (
                          <p className="mt-1 text-right text-xs text-red-700 dark:text-red-300">
                            {state.error}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
