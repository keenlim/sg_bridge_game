# Word Agents

Original funCentral team word-association game inspired by the mechanics of Codenames. No CGE artwork, logos, rulebook text or publisher word deck is included. Word Agents is not an official Codenames product.

## Play

Open `/wordagents/`, sign in through the existing Telegram identity, create a room and share the invite. Four to twelve players choose red/blue teams with exactly one spymaster and at least one operative per team. The host starts once everyone is assigned and connected. Signed-out visitors may watch but cannot play.

A random 5×5 board contains nine agents for the starting team, eight for the other team, seven civilians and one assassin. Spymasters alone receive the unrevealed key. A turn starts with a single English word and number 1–9. Operatives reveal at least one card, then may stop; they can make up to count+1 guesses while correct. A civilian/opponent ends the turn, an assassin loses instantly, and completing either team's agents awards that team the win. Basic clue validation blocks board words and substrings; players judge semantic fairness. Advanced zero/unlimited clues are deliberately out of scope.

Use separate devices for spymasters. Roles cannot change during a round, including after reconnect. All action legality, key projection, shuffle and stale-command guards are server-side. Gameplay is casual/unranked: no D1 migration, scores or existing game ratings are touched. State persists in its own SQLite Durable Object. Empty rooms expire after 30 minutes. Refresh/reconnect retains roles and current board; a second tab replaces the previous connection.

## Integration and release

- `src/wordagents/`: rules and room authority.
- `static/wordagents/`: responsive accessible client; shared `/style.css` and `/fc-auth.js`.
- `WORDAGENTS_ROOM` / `WordAgentsRoom` with additive DO migration `v6`.
- `/api/wordagents/create`, `/api/wordagents/ws` and `/newwordagents`.
- Shared catalog, hub and local Worker harness extended. No existing game route changed.
- Merge deploys through the existing Workers Builds pipeline. Never manually deploy for QA.

## Checks

`npx vitest run tests/wordagents-engine.test.ts tests/wordagents-room.test.ts`

`npx playwright test tests/ui/wordagents-ui.pw.js`

Always also run `npm run test:pr`. Fixture UI tests are not live multiplayer/browser E2E. Automated Chromium mobile emulation does not verify iOS Safari or physical touch devices.
