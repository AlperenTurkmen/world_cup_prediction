# World Cup 2026 Prediction Leaderboard — Wiki

Welcome! This wiki is the friendly, task-oriented companion to the
[README](https://github.com/AlperenTurkmen/world_cup_prediction#readme) and the
in-repo developer docs. If you want to **run a prediction pool**, **deploy your
own copy**, or **understand how scoring works**, start here.

> The app lets a group forecast all 104 matches of the FIFA World Cup 2026 —
> group-stage scorelines plus knockout advancement to the champion — and ranks
> everyone on a live, multi-dimensional leaderboard as real results come in.

## Pick your path

| You are… | Go to |
|----------|-------|
| 🆕 New here and want the gist | [Architecture Overview](Architecture-Overview) |
| 💻 A developer setting up locally | [Getting Started](Getting-Started) |
| 🚀 Deploying your own instance | [Deployment](Deployment) |
| 🏆 Running the pool (logging results) | [Admin Guide](Admin-Guide) |
| 🎯 A participant making predictions | [Making Predictions](Making-Predictions) |
| 🧮 Curious how points are awarded | [Scoring System](Scoring-System) |
| 👥 Setting up leagues / following friends | [Leagues & Social](Leagues-and-Social) |
| 🔄 Automating result updates | [Results Auto-Sync](Results-Auto-Sync) |
| ❓ Stuck on something | [FAQ](FAQ) |

## What makes it tick

- **Two ways to predict, one immutable entry.** Upload a filled
  [Hermann Baum Excel workbook](https://hermann-baum.de/excel/WorldCup/de), or
  use the in-app stepper. Both produce the same stored entry.
- **Scoring lives in SQL and is computed on read.** Nothing is pre-scored; the
  leaderboard re-derives every dimension on each page load.
- **Fairness gating.** A prediction only scores a result that was logged *after*
  it was submitted — late joiners can't cheat off known outcomes.

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres,
server-only) · SheetJS (`xlsx`) · Vercel.

---

*This wiki mirrors Markdown kept under `wiki/` in the main repository. Edit there
and re-publish, or edit pages directly on GitHub.*
