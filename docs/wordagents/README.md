# Word Agents

Original funCentral team word-association game inspired by the mechanics of classic team word-deduction party games. No third-party artwork, logos, rulebook text or publisher word deck is included, and Word Agents is not affiliated with any publisher.

## Play

Open `/wordagents/`, sign in through the shared Telegram identity, create a room and share the invite. Signed-out visitors can watch and sign in from the lobby without losing the invite.

- **Lobby.** Four to twelve players join the room. Under **Team setup**, the host can leave **Random teams** selected for a balanced shuffle or select **Choose teams** for prearranged groups. Each seated player then picks **Join Red** or **Join Blue**. The host can start once everyone is online and, in Choose teams, has picked a side with at least two players on each team. Each player in Choose teams can optionally vote for an online teammate (including themselves) under **Nominate a spymaster**. The most votes on each side wins; ties are broken randomly among the leaders, and a team with no votes gets a random spymaster. Random teams still assigns all roles automatically. The host can remove offline players; removed players may still watch but cannot rejoin that room.
- **Board.** A random 5×5 board holds nine agents for the starting team, eight for the other, seven civilians and one assassin. Every card shows a coordinate (A1–E5) so remote teams can talk about it in chat or on a call.
- **Spymasters** alone see the key: tinted cards with a colour band and a shape (◆ red, ● blue, — civilian, ✕ assassin) so colour is never the only cue. **Hide key** blanks the tints on their own screen. The clue dock checks one-word, letters-only clues inline and blocks words that are, or contain, an unrevealed board word; the server repeats every check.
- **Operatives** tap a card to select it, then **Reveal** it or **Mark** it. Marks show the marker’s initials on the card for everyone, so a team on separate devices can converge before committing. Marks are advisory: they clear on reveal and at the end of the turn, and never invalidate a teammate’s pending reveal. After at least one guess, **End turn** asks for confirmation.
- **Turn rules.** Up to count + 1 guesses while correct. A civilian or opposing agent ends the turn, the assassin loses instantly, and the first team to uncover all of its agents wins. Zero/unlimited clues are out of scope.
- **Results.** The full key is revealed. The host can start a **New round** with the same team mode or go **Back to lobby** to adjust the roster, teams or settings; everyone else sees who won and why.

The screen keeps a live connection dot, watcher count, optional synthesised sounds (off by default), reveal animations that respect reduced motion, toasts for every reveal, a per-turn mission log, a sticky action dock on phones and arrow-key navigation across the board.

## Authority and privacy

All legality, key projection, shuffles and stale-command guards are server-side in `WordAgentsRoom`. Spymasters receive the key; operatives, watchers and guests receive colours only for revealed cards until the round ends. Clue, guess and end-turn commands carry the board `revision`; marks and presence changes are broadcast without bumping it. Rejoining is a no-op, so a reconnect never disturbs an in-flight command.

Roles lock for the round, including after reconnect; a second tab takes over the seat, and the first tab can take it back. The chosen host keeps the room through a refresh: while they are offline the first connected player stands in, and host controls return when they reconnect. Players can join only from the lobby. In Random teams, a rematch draws teams and roles again. In Choose teams, sides and nominations survive refreshes and apply to rematches; return to the lobby to change either. Moving, leaving or removing a seat clears votes by and for that player. Switching to Random teams clears all side selections and votes.

Gameplay is casual and unrated: no D1 tables, scores or other games’ ratings are touched. State persists in the room’s own SQLite Durable Object; empty rooms expire after 30 minutes.

## Integration and release

- `src/wordagents/engine.ts` (rules, structured public history, marks) and `src/wordagents/room.ts` (room authority).
- `static/wordagents/`: client built on the shared `/style.css` design system (`.top-bar`, `.home-container`, `.lobby-container`, `.overlay`, `.gameover-container`) plus `/fc-auth.js`.
- `WORDAGENTS_ROOM` / `WordAgentsRoom` with additive DO migration `v6`; no D1 migration.
- `/api/wordagents/create`, `/api/wordagents/ws`, `/newwordagents` (alias `/newwordagentsgame`) and the `/newgame` chooser.
- Merge deploys through the existing Workers Builds pipeline. Never deploy manually for QA.

## Checks

```sh
npm run test:wordagents       # engine + room (Vitest, real SQLite Durable Object)
npm run test:wordagents:ui    # fixture UI + live multiplayer (port 4250)
npm run test:pr               # always, before merge
```

`tests/ui/wordagents-capture.cjs` regenerates the [screenshot gallery](screenshots/QA.md) from real local rounds (port 4252); it is not a test. Chromium mobile emulation does not verify iOS Safari, Telegram WebView or physical touch devices.

## Public word pack

The public Worker includes a 168-card AEO-themed word bank with AEO platform
labels, common AI, delivery and workplace terms, and Singapore-themed wildcards. Each board draws 15 themed words,
six technology words, and four wildcards. Players and guests can see the dealt
words. The public word bank ships with the game and needs no runtime settings.

Any public room host can choose **Word pack → Classic** or **Word pack → AEO**
before starting. Classic is the default for a new room. The chosen pack carries
into rematches, and the host can return to the lobby to change it. The public
pack uses the usual Telegram requirements for players and allows guests to watch.
It can run on the existing public Worker without a database migration.

## Team-only word pack

For an approved **separate** installation, set both server-side bindings:

- `WORDAGENTS_TEAM_IDS`: comma-separated numeric Telegram user IDs for approved players. Use verified numeric IDs, not display names or usernames. At least four approved players are needed to start.
- `WORDAGENTS_AEO_DECK`: compact JSON with arrays named `themed`, `technology`, and `wildcards`. Keep this as a Worker secret or in the ignored local secret file, not in the repository, static assets, logs or public preview. Both bindings are outside the browser bundle.

If either team-only binding is supplied, Word Agents room access is team-only: signed-out and unlisted visitors cannot receive lobby or board state, even with the invite. This restriction applies to Classic rooms on the configured installation as well. Missing or invalid member IDs allow nobody in; missing or invalid private deck data never enables AEO in a team-only room. Persisted private rooms stay restricted if bindings are removed. Keep these two bindings off the original public Worker and use separate storage and credentials for the team-only installation.

In the lobby, the host selects **Word pack → AEO** before starting. The server deals 15 AEO-themed, six general technology and four wildcard labels, shuffled across the same 25-card board. Multi-word labels stay together. Rematches keep the pack. Return to the lobby to switch packs. Approved accounts can still spectate; the usual spymaster key and role rules still apply.
