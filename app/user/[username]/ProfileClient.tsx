"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { getTeamFlag } from "@/lib/flags";
import type { AdvRound } from "@/lib/rounds";
import { MAX_USERNAME_LEN } from "@/lib/manualEntry";

const MAX_USERNAME_CHANGES = 3;

interface MatchPrediction {
  predHome: number;
  predAway: number;
  isScoreEligible: boolean;
  matchId: number;
  matchNo: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  resultLoggedAt: string | null;
}

interface KnockPrediction {
  round: string;
  team: string;
}

interface PlayerStats {
  group_points: number;
  ranking_points: number;
  knockout_points: number;
  total: number;
  exact_count: number;
  played_count: number;
  champion_pick: string | null;
  champion_correct: number;
}

interface ProfileClientProps {
  profileId: number;
  username: string;
  createdAt: string;
  usernameChangesUsed: number;
  rank: number | null;
  stats: PlayerStats | null;
  followers: { id: number; username: string }[];
  following: { id: number; username: string }[];
  currentUser: { id: number; username: string } | null;
  isFollowingInitial: boolean;
  predictions: MatchPrediction[];
  knockoutPredictions: KnockPrediction[];
  actualAdvancers: Record<AdvRound, string[]>;
  scoringWeights: Record<string, number>;
  roundWeights: Record<string, number>;
}

interface FollowedPred {
  username: string;
  predHome: number;
  predAway: number;
}

export default function ProfileClient({
  profileId,
  username,
  createdAt,
  usernameChangesUsed,
  rank,
  stats,
  followers: initialFollowers,
  following,
  currentUser,
  isFollowingInitial,
  predictions,
  knockoutPredictions,
  actualAdvancers,
  scoringWeights,
  roundWeights,
}: ProfileClientProps) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "group" | "knockout">("dashboard");
  const [isFollowing, setIsFollowing] = useState(isFollowingInitial);
  const [followers, setFollowers] = useState(initialFollowers);
  const [socialModal, setSocialModal] = useState<"followers" | "following" | null>(null);

  // Match detail modal state
  const [selectedMatch, setSelectedMatch] = useState<MatchPrediction | null>(null);
  const [followedPreds, setFollowedPreds] = useState<FollowedPred[]>([]);
  const [loadingFollowed, setLoadingFollowed] = useState(false);
  const [followedError, setFollowedError] = useState<string | null>(null);

  // Predictions filter state
  const [groupFilter, setGroupFilter] = useState<"all" | "exact" | "outcome" | "incorrect" | "pending">("all");

  const isOwnProfile = currentUser?.id === profileId;

  // Username editing (own profile only). Players get MAX_USERNAME_CHANGES renames.
  const router = useRouter();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(username);
  const [changesUsed, setChangesUsed] = useState(usernameChangesUsed);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const changesRemaining = Math.max(0, MAX_USERNAME_CHANGES - changesUsed);

  function openNameEditor() {
    setNameInput(username);
    setNameError(null);
    setEditingName(true);
  }

  async function saveUsername() {
    const trimmed = nameInput.trim();
    if (savingName) return;
    if (trimmed.length === 0) {
      setNameError("Please enter a username.");
      return;
    }
    // No-op (same spelling) — just close.
    if (trimmed === username) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch("/api/user/change-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setNameError(data.error || "Could not change your username.");
        setSavingName(false);
        return;
      }
      setChangesUsed(data.changesUsed ?? changesUsed);
      setEditingName(false);
      setSavingName(false);
      // The username is part of the profile URL — navigate to the new one and
      // refresh server data so every place that shows the name updates.
      router.replace(`/user/${encodeURIComponent(data.username)}`);
      router.refresh();
    } catch {
      setNameError("Something went wrong. Please try again.");
      setSavingName(false);
    }
  }

  // Generate a custom gradient background based on the username
  function getAvatarGradient(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c1 = Math.abs(hash % 360);
    const c2 = (c1 + 120) % 360;
    return `linear-gradient(135deg, hsl(${c1}, 70%, 55%), hsl(${c2}, 70%, 45%))`;
  }

  // Handle follow / unfollow actions
  async function toggleFollow() {
    if (!currentUser) return;

    const endpoint = isFollowing ? "/api/user/unfollow" : "/api/user/follow";
    // Optimistic UI updates
    setIsFollowing(!isFollowing);
    if (isFollowing) {
      setFollowers(followers.filter((f) => f.id !== currentUser.id));
    } else {
      setFollowers([...followers, { id: currentUser.id, username: currentUser.username }]);
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followedId: profileId }),
      });
      if (!res.ok) {
        // Rollback on error
        setIsFollowing(isFollowing);
        setFollowers(initialFollowers);
      }
    } catch {
      setIsFollowing(isFollowing);
      setFollowers(initialFollowers);
    }
  }

  // Load followed users' predictions when a match is selected
  useEffect(() => {
    if (!selectedMatch || !currentUser) {
      setFollowedPreds([]);
      return;
    }

    const matchId = selectedMatch.matchId;

    async function fetchFollowedPredictions() {
      setLoadingFollowed(true);
      setFollowedError(null);
      try {
        const res = await fetch(`/api/user/followed-predictions?matchId=${matchId}`);
        const data = await res.json();
        if (res.ok && data.ok) {
          setFollowedPreds(data.predictions);
        } else {
          setFollowedError(data.error || "Failed to load predictions.");
        }
      } catch {
        setFollowedError("Network error loading predictions.");
      } finally {
        setLoadingFollowed(false);
      }
    }

    fetchFollowedPredictions();
  }, [selectedMatch, currentUser]);

  // Compute prediction metrics
  function getPredictionStatus(pred: MatchPrediction) {
    if (pred.homeGoals === null || pred.awayGoals === null) return "pending";

    const isExact = pred.predHome === pred.homeGoals && pred.predAway === pred.awayGoals;
    if (isExact) return "exact";

    const predOutcome = Math.sign(pred.predHome - pred.predAway);
    const actualOutcome = Math.sign(pred.homeGoals - pred.awayGoals);
    if (predOutcome === actualOutcome) return "outcome";

    return "incorrect";
  }

  // Calculate points for a group match (Dimension A)
  function getMatchPoints(pred: MatchPrediction): number {
    if (pred.homeGoals === null || pred.awayGoals === null || !pred.isScoreEligible) return 0;

    let pts = 0;
    const wOutcome = scoringWeights.W_OUTCOME ?? 2;
    const wGoaldiff = scoringWeights.W_GOALDIFF ?? 1;
    const wTeamgoals = scoringWeights.W_TEAMGOALS ?? 1;
    const wExact = scoringWeights.W_EXACT ?? 3;

    const predOutcome = Math.sign(pred.predHome - pred.predAway);
    const actualOutcome = Math.sign(pred.homeGoals - pred.awayGoals);

    if (predOutcome === actualOutcome) {
      pts += wOutcome;
    }
    if (pred.predHome - pred.predAway === pred.homeGoals - pred.awayGoals) {
      pts += wGoaldiff;
    }
    if (pred.predHome === pred.homeGoals) {
      pts += wTeamgoals;
    }
    if (pred.predAway === pred.awayGoals) {
      pts += wTeamgoals;
    }
    if (pred.predHome === pred.homeGoals && pred.predAway === pred.awayGoals) {
      pts += wExact;
    }

    return pts;
  }

  // Filter predictions list
  const filteredPredictions = predictions.filter((pred) => {
    const status = getPredictionStatus(pred);
    if (groupFilter === "all") return true;
    if (groupFilter === "exact") return status === "exact";
    if (groupFilter === "outcome") return status === "outcome";
    if (groupFilter === "incorrect") return status === "incorrect";
    if (groupFilter === "pending") return status === "pending";
    return true;
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 text-foreground">
      {/* 1. Header Profile Panel */}
      <section className="relative overflow-hidden rounded-2xl border border-black/15 bg-white p-6 shadow-md dark:border-white/10 dark:bg-[#111111]">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-inner"
              style={{ background: getAvatarGradient(username) }}
            >
              {username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              {editingName ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={nameInput}
                      maxLength={MAX_USERNAME_LEN}
                      disabled={savingName}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveUsername();
                        if (e.key === "Escape") setEditingName(false);
                      }}
                      className="w-48 rounded-lg border border-black/15 bg-background px-3 py-1.5 text-lg font-bold tracking-tight outline-none focus:border-foreground/40 dark:border-white/20"
                    />
                    <button
                      onClick={saveUsername}
                      disabled={savingName}
                      className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                      {savingName ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      disabled={savingName}
                      className="rounded-lg px-2 py-1.5 text-xs font-medium text-foreground/60 hover:text-foreground cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  {nameError ? (
                    <p className="text-xs text-red-600 dark:text-red-400">{nameError}</p>
                  ) : (
                    <p className="text-xs text-foreground/50">
                      {changesRemaining} of {MAX_USERNAME_CHANGES} changes remaining
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">{username}</h1>
                  {isOwnProfile && changesRemaining > 0 && (
                    <button
                      onClick={openNameEditor}
                      title={`Change username (${changesRemaining} of ${MAX_USERNAME_CHANGES} remaining)`}
                      aria-label="Change username"
                      className="rounded-md p-1 text-foreground/40 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 cursor-pointer"
                    >
                      ✏️
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-foreground/50 mt-0.5">
                Joined {new Date(createdAt).toLocaleDateString()}
              </p>
              <div className="mt-2 flex gap-4 text-sm font-medium">
                <button
                  onClick={() => setSocialModal("followers")}
                  className="hover:underline cursor-pointer"
                >
                  <strong className="text-foreground">{followers.length}</strong>{" "}
                  <span className="text-foreground/60">Followers</span>
                </button>
                <button
                  onClick={() => setSocialModal("following")}
                  className="hover:underline cursor-pointer"
                >
                  <strong className="text-foreground">{following.length}</strong>{" "}
                  <span className="text-foreground/60">Following</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isOwnProfile && currentUser && (
              <button
                onClick={toggleFollow}
                className={`w-full sm:w-auto px-5 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                  isFollowing
                    ? "bg-black/10 text-foreground hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
                    : "bg-foreground text-background hover:opacity-90"
                }`}
              >
                {isFollowing ? "Unfollow" : "Follow"}
              </button>
            )}
            {!currentUser && (
              <Link
                href={`/login?redirectTo=/user/${encodeURIComponent(username)}`}
                className="w-full sm:w-auto px-4 py-2 text-center rounded-lg text-xs font-semibold bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-foreground/80 hover:text-foreground"
              >
                Log in to follow
              </Link>
            )}
            {stats && (
              <div className="flex flex-col items-end rounded-xl bg-black/5 dark:bg-white/5 px-4 py-2 text-right">
                <span className="text-xs text-foreground/50 font-medium">Global Rank</span>
                <span className="text-xl font-bold tracking-tight">
                  {rank ? `#${rank}` : "—"}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. Tabs Switcher */}
      <div className="mt-8 flex border-b border-black/10 dark:border-white/10">
        {(["dashboard", "group", "knockout"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-semibold tracking-wide border-b-2 transition-all cursor-pointer capitalize ${
              activeTab === tab
                ? "border-foreground text-foreground"
                : "border-transparent text-foreground/50 hover:text-foreground"
            }`}
          >
            {tab === "group" ? "Group Predictions" : tab === "knockout" ? "Knockout Bracket" : tab}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div className="mt-6">
        {/* TAB 1: DASHBOARD */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* Stats Dashboard Grid */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/50 p-4 dark:bg-white/5">
                <span className="text-xs text-foreground/50 font-medium block">Total Points</span>
                <strong className="text-2xl font-bold mt-1 block">{stats?.total ?? 0} pts</strong>
              </div>
              <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/50 p-4 dark:bg-white/5">
                <span className="text-xs text-foreground/50 font-medium block">Group Match Points</span>
                <strong className="text-2xl font-bold mt-1 block">{stats?.group_points ?? 0} pts</strong>
              </div>
              <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/50 p-4 dark:bg-white/5">
                <span className="text-xs text-foreground/50 font-medium block">Group Standing Points</span>
                <strong className="text-2xl font-bold mt-1 block">{stats?.ranking_points ?? 0} pts</strong>
              </div>
              <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/50 p-4 dark:bg-white/5">
                <span className="text-xs text-foreground/50 font-medium block">Knockout Bonus</span>
                <strong className="text-2xl font-bold mt-1 block">{stats?.knockout_points ?? 0} pts</strong>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {/* Predicted Champion Card */}
              <div className="md:col-span-2 rounded-2xl border border-black/10 dark:border-white/10 bg-white/40 p-6 dark:bg-white/5 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground/50 uppercase tracking-wider">
                    Predicted Champion
                  </h3>
                  {stats?.champion_pick ? (
                    <div className="mt-4 flex items-center gap-4">
                      <span className="text-5xl">{getTeamFlag(stats.champion_pick)}</span>
                      <div>
                        <strong className="text-3xl font-extrabold tracking-tight block">
                          {stats.champion_pick}
                        </strong>
                        {stats.champion_correct === 1 ? (
                          <span className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-green-600 dark:text-green-400">
                            ✨ Correct Champion Pick!
                          </span>
                        ) : (
                          <span className="text-xs text-foreground/40 mt-1 block">
                            Champion Weight: {roundWeights.CHAMPION ?? 12} pts
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 text-foreground/40 text-sm">No champion selected.</div>
                  )}
                </div>

                <div className="mt-6 border-t border-black/5 dark:border-white/5 pt-4 text-xs text-foreground/60 flex items-center justify-between">
                  <span>Predictions played: <strong>{stats?.played_count ?? 0}</strong></span>
                  <span>Exact group scorelines: <strong>{stats?.exact_count ?? 0}</strong></span>
                  <span>Submission time: <strong>{new Date(createdAt).toLocaleTimeString()}</strong></span>
                </div>
              </div>

              {/* Quick Summary list */}
              <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/40 p-6 dark:bg-white/5 space-y-4">
                <h3 className="text-sm font-semibold text-foreground/50 uppercase tracking-wider">
                  Knockout Accuracy
                </h3>
                <div className="space-y-3">
                  {(["R32", "R16", "QF", "SF", "FINAL"] as const).map((round) => {
                    const totalPredicted = knockoutPredictions.filter((p) => p.round === round).length;
                    const correctCount = knockoutPredictions.filter(
                      (p) => p.round === round && actualAdvancers[round]?.includes(p.team)
                    ).length;

                    return (
                      <div key={round} className="flex justify-between items-center text-sm">
                        <span className="font-medium text-foreground/75">
                          {round === "R32" && "Round of 32"}
                          {round === "R16" && "Round of 16"}
                          {round === "QF" && "Quarter-finals"}
                          {round === "SF" && "Semi-finals"}
                          {round === "FINAL" && "Finalists"}
                        </span>
                        <span className="text-xs bg-black/5 dark:bg-white/5 rounded px-2 py-0.5 font-bold tabular-nums">
                          {correctCount} / {totalPredicted}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: GROUP PREDICTIONS */}
        {activeTab === "group" && (
          <div className="space-y-4">
            {/* Filter buttons */}
            <div className="flex flex-wrap gap-2">
              {[
                { id: "all", label: "All Predictions" },
                { id: "exact", label: "Exact Score (+3)" },
                { id: "outcome", label: "Outcome Only (+1/2)" },
                { id: "incorrect", label: "Incorrect" },
                { id: "pending", label: "Unplayed" },
              ].map((btn) => (
                <button
                  key={btn.id}
                  onClick={() => setGroupFilter(btn.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                    groupFilter === btn.id
                      ? "bg-foreground text-background"
                      : "bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 text-foreground/75"
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* List of Predictions */}
            <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#111111] shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5 font-semibold text-foreground/70">
                      <th className="p-3 text-center w-12">Match</th>
                      <th className="p-3">Teams</th>
                      <th className="p-3 text-center w-24">Prediction</th>
                      <th className="p-3 text-center w-24">Actual</th>
                      <th className="p-3 text-center w-20">Points</th>
                      <th className="p-3 text-center w-20">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPredictions.map((pred) => {
                      const status = getPredictionStatus(pred);
                      const points = getMatchPoints(pred);

                      return (
                        <tr
                          key={pred.matchId}
                          onClick={() => setSelectedMatch(pred)}
                          className="border-b border-black/5 last:border-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02] cursor-pointer transition-colors"
                        >
                          <td className="p-3 text-center font-medium opacity-50 tabular-nums">
                            {pred.matchNo}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span>{getTeamFlag(pred.homeTeam)}</span>
                              <span className="font-semibold">{pred.homeTeam}</span>
                              <span className="text-foreground/40 font-normal">vs</span>
                              <span>{getTeamFlag(pred.awayTeam)}</span>
                              <span className="font-semibold">{pred.awayTeam}</span>
                            </div>
                          </td>
                          <td className="p-3 text-center font-bold tabular-nums">
                            {pred.predHome} - {pred.predAway}
                          </td>
                          <td className="p-3 text-center font-medium opacity-80 tabular-nums">
                            {pred.homeGoals !== null && pred.awayGoals !== null
                              ? `${pred.homeGoals} - ${pred.awayGoals}`
                              : "—"}
                          </td>
                          <td className="p-3 text-center font-bold tabular-nums">
                            {pred.homeGoals !== null && pred.awayGoals !== null ? `+${points}` : "—"}
                          </td>
                          <td className="p-3 text-center">
                            {status === "exact" && (
                              <span className="inline-block rounded-md bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 text-xs font-semibold text-yellow-600 dark:text-yellow-400">
                                Exact
                              </span>
                            )}
                            {status === "outcome" && (
                              <span className="inline-block rounded-md bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                                Outcome
                              </span>
                            )}
                            {status === "incorrect" && (
                              <span className="inline-block rounded-md bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
                                Wrong
                              </span>
                            )}
                            {status === "pending" && (
                              <span className="inline-block rounded-md bg-foreground/5 border border-foreground/10 px-2 py-0.5 text-xs font-semibold opacity-60">
                                Pending
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredPredictions.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-foreground/40">
                          No matches fit this filter criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: KNOCKOUT BRACKET */}
        {activeTab === "knockout" && (
          <div className="space-y-8">
            {(["R32", "R16", "QF", "SF", "FINAL", "CHAMPION"] as const).map((round) => {
              const roundTeams = knockoutPredictions.filter((p) => p.round === round);
              const actuals = actualAdvancers[round] || [];
              const roundName =
                round === "R32"
                  ? "Round of 32"
                  : round === "R16"
                  ? "Round of 16"
                  : round === "QF"
                  ? "Quarter-finals"
                  : round === "SF"
                  ? "Semi-finals"
                  : round === "FINAL"
                  ? "Finalists"
                  : "Champion";

              return (
                <div
                  key={round}
                  className="rounded-xl border border-black/10 dark:border-white/10 bg-white/40 p-5 dark:bg-white/5"
                >
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/50 flex items-center justify-between">
                    <span>{roundName}</span>
                    <span className="text-xs bg-black/5 dark:bg-white/5 rounded px-2 py-0.5 font-bold tracking-normal text-foreground normal-case">
                      +{roundWeights[round] ?? 0} pts per team
                    </span>
                  </h3>
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    {roundTeams.map((item) => {
                      const isLogged = actuals.length > 0;
                      const isCorrect = actuals.includes(item.team);

                      return (
                        <div
                          key={item.team}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold tracking-wide shadow-sm transition-all ${
                            !isLogged
                              ? "bg-white border-black/10 text-foreground dark:bg-[#151515] dark:border-white/10"
                              : isCorrect
                              ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400"
                              : "bg-red-500/5 border-red-500/20 text-red-700/60 dark:text-red-400/60 line-through decoration-red-500/40"
                          }`}
                        >
                          <span>{getTeamFlag(item.team)}</span>
                          <span>{item.team}</span>
                          {isLogged && (isCorrect ? "✓" : "✗")}
                        </div>
                      );
                    })}
                    {roundTeams.length === 0 && (
                      <span className="text-xs text-foreground/30 italic">No predictions saved.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Followers/Following modal dialog */}
      {socialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-black/15 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#111111]">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold capitalize">{socialModal}</h3>
              <button
                onClick={() => setSocialModal(null)}
                className="text-foreground/50 hover:text-foreground text-xl cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="mt-4 max-h-60 overflow-y-auto space-y-2">
              {socialModal === "followers" &&
                followers.map((u) => (
                  <Link
                    key={u.id}
                    href={`/user/${encodeURIComponent(u.username)}`}
                    onClick={() => setSocialModal(null)}
                    className="block rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5 text-sm font-medium transition-colors"
                  >
                    ⚽ {u.username}
                  </Link>
                ))}
              {socialModal === "following" &&
                following.map((u) => (
                  <Link
                    key={u.id}
                    href={`/user/${encodeURIComponent(u.username)}`}
                    onClick={() => setSocialModal(null)}
                    className="block rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5 text-sm font-medium transition-colors"
                  >
                    ⚽ {u.username}
                  </Link>
                ))}
              {((socialModal === "followers" && followers.length === 0) ||
                (socialModal === "following" && following.length === 0)) && (
                <p className="text-sm text-foreground/40 italic py-4 text-center">Empty list.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. Clicked Match Details Modal (with Followed predictions) */}
      {selectedMatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-black/15 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#111111] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
              <h3 className="text-base font-bold text-foreground/55">
                Match {selectedMatch.matchNo} Details
              </h3>
              <button
                onClick={() => setSelectedMatch(null)}
                className="text-foreground/50 hover:text-foreground text-xl cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 flex flex-col items-center justify-center p-4 rounded-xl bg-black/5 dark:bg-white/5">
              <div className="flex items-center gap-4 text-lg font-bold">
                <span className="text-3xl">{getTeamFlag(selectedMatch.homeTeam)}</span>
                <span>{selectedMatch.homeTeam}</span>
                <span className="text-foreground/40">vs</span>
                <span>{selectedMatch.awayTeam}</span>
                <span className="text-3xl">{getTeamFlag(selectedMatch.awayTeam)}</span>
              </div>
              {selectedMatch.kickoffAt && (
                <div className="text-xs text-foreground/50 mt-1 font-medium">
                  Kickoff: {new Date(selectedMatch.kickoffAt).toLocaleString()}
                </div>
              )}
              <div className="mt-3 flex gap-8">
                <div className="text-center">
                  <span className="text-xs text-foreground/50 font-semibold uppercase tracking-wider block">
                    Prediction
                  </span>
                  <span className="text-2xl font-black mt-0.5 block">
                    {selectedMatch.predHome} - {selectedMatch.predAway}
                  </span>
                </div>
                {selectedMatch.homeGoals !== null && selectedMatch.awayGoals !== null && (
                  <div className="text-center">
                    <span className="text-xs text-foreground/50 font-semibold uppercase tracking-wider block">
                      Actual
                    </span>
                    <span className="text-2xl font-black mt-0.5 block">
                      {selectedMatch.homeGoals} - {selectedMatch.awayGoals}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Social Predictions Panel */}
            <div className="mt-6 flex-1 overflow-y-auto min-h-0">
              <h4 className="text-sm font-bold text-foreground/75 tracking-tight border-b border-black/5 dark:border-white/5 pb-2">
                👥 What followed players predicted:
              </h4>

              {!currentUser ? (
                <p className="text-xs text-foreground/50 mt-3 text-center py-4">
                  Please{" "}
                  <Link
                    href={`/login?redirectTo=/user/${encodeURIComponent(username)}`}
                    className="underline text-foreground font-semibold"
                    onClick={() => setSelectedMatch(null)}
                  >
                    Log In
                  </Link>{" "}
                  to see predictions from followed users.
                </p>
              ) : loadingFollowed ? (
                <div className="py-8 text-center text-xs opacity-50">Loading predictions...</div>
              ) : followedError ? (
                <div className="py-4 text-center text-xs text-red-600 dark:text-red-400">
                  {followedError}
                </div>
              ) : followedPreds.length === 0 ? (
                <p className="text-xs text-foreground/45 italic py-6 text-center">
                  None of the players you follow have predictions logged for this game or you don't follow anyone yet.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {followedPreds.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg p-2.5 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-sm font-medium"
                    >
                      <span>⚽ {f.username}</span>
                      <strong className="text-base font-black tabular-nums">
                        {f.predHome} - {f.predAway}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
