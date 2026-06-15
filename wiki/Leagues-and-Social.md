# Leagues & Social

Beyond the global leaderboard, the app supports private competitions and
following other players.

## Accounts

Players sign in with **Google** (the primary path) or an optional
**username/password** fallback. A Google account is linked to a prediction entry
by its stable Google subject id and email, and sets the same signed `wc_player`
session cookie the username/password login uses.

You can change your username from your profile; follower counts and links update
accordingly.

## Profiles & follows

Every player has a public profile at `/user/<username>` showing their entry and
standing. You can **follow** other players to keep an eye on their predictions
and see how you stack up.

## Leagues

Leagues are self-contained leaderboards on top of the same entries.

| Type | Who can join |
|------|--------------|
| **Public** | Anyone can find and join. |
| **Private** | Join only with the league's invite code. |

Each league has its own board computed from the same global scoring weights, plus
an optional **start cutoff** — "ignore games before match N" — so a league that
forms partway through the tournament can score only from its start point. Create
a league, share its code (for private leagues), and members appear on its board
automatically.

## How league scoring relates to the global board

Leagues reuse the exact same scoring engine and weights as the global
leaderboard. The only league-specific knob is the start cutoff; everything else —
the four scoring dimensions, fairness gating, tiebreaks — is identical. See
[Scoring System](Scoring-System).
