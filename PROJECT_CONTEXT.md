# Project Context

This file is the quick-reference notes file for the project. Update it whenever game rules, room flow, deployment behavior, UI structure, or major assets change.

## Product

- Name: `Exploding Productions`
- Type: browser-based multiplayer card game
- Theme: comedic tech / coding chaos
- Transport: custom Python WebSocket server with static file hosting

## Runtime

- Entry server: [server.py](server.py)
- Lobby page: [index.html](index.html)
- Live room page: [room.html](room.html)
- Client logic: [app/lobby.js](app/lobby.js), [app/room.js](app/room.js)
- Styling: [styles.css](styles.css)
- Default local URL: `http://localhost:8765`
- Health endpoint: `/health`

## Core Game Rules

- Each player starts with `1` `Blame The Intern` and `5` random cards.
- The draw deck keeps `Blame The Intern` at `(Production Crashes left in deck + 1)`, while each player still starts with `1` guaranteed copy in hand.
- The draw pile now uses the full normal deck size after setup instead of the temporary `10`-card test cap.
- A turn normally ends with a draw.
- `Skip` is the only action card that skips the turn-ending draw.
- `Sprint Planning` gives the next player `+1` required draw, but the acting player still draws to end their own turn.
- `Nope` cancels the latest action or combo unless another `Nope` flips it back.
- Drawing `Production Crash` without `Blame The Intern` eliminates the player.
- Drawing `Production Crash` with `Blame The Intern` discards both cards.
- Production Crash count per round is exactly `(player count - 1)`.
- If the draw deck runs out and there are used cards in the discard pile, the discard pile is shuffled back into the deck instead of immediately ending the round.
- Combo rules:
  - `2` matching cards: steal a random card
  - `3` matching cards: request a specific card
  - `5` different cards: reclaim one discard-pile card
  - Any non-`Production Crash` card, including `Nope` and `Blame The Intern`, is combo-eligible.

## Card Theme Mapping

- `Production Crash`
- `Blame The Intern`
- `Nope`
- `Peer Review`
- `Skip`
- `Sprint Planning`
- `Shuffle`
- `Project Manager`
- `Rubber Duck`
- `Coffee Break`
- `Sticky Note`
- `Mechanical Keyboard`
- `Posh Training`

## Multiplayer / Room Behavior

- Room codes are `4` uppercase letters.
- Each room supports up to `6` players.
- The `Engineering Team` sidebar only exposes public information; it does not reveal how many `Blame The Intern` cards another player holds.
- The live room page uses `/room?room=ABCD`.
- The client stores a per-room reconnect token in `localStorage`.
- Refreshing in the same browser should rejoin the same room seat automatically.
- Explicit `Leave` clears the stored reconnect token for that room.
- Room creation and general code entry now happen on the lobby page, while active gameplay lives on the dedicated room page.
- During a live match, the room access controls collapse and the active room panel remains as the primary room-control area.

## Server Notes

- Room state is held in memory inside a single Python process.
- This should run as a single instance unless shared persistent state is added.
- Player reconnection is handled by a per-player session token stored on the client.
- Disconnecting mid-match now preserves the seat for reconnect instead of eliminating the player immediately.

## UI Notes

- Card art lives in `assets/cards/`.
- The live deck should use the consistent illustrated `Git Rekt`-style card-art set; avoid mixing in unrelated standalone images for individual cards.
- The card-art mappings should stay aligned with the current filenames in `assets/cards/`, including `skip.webp`, `shuffle.webp`, `sprint-planning.webp`, `coffee-break.webp`, `mechanical-keyboard.webp`, and `posh-training.webp`.
- The incident log is collapsible.
- A `Production Crash` overlay animation appears for crash moments.
- Draws and action plays now use a lightweight animated moment overlay.
- Random steals and requested-card transfers now trigger the same card-gain moment treatment so the gained card is visible immediately.
- `Peer Review` now opens a private reveal panel showing the next three cards.
- The hand area contains the primary turn-ending draw control.
- The action prompt now lives directly above the hand controls instead of in the center board column.
- A compact sticky turn ribbon now sits above the board during live matches, the room-access card is hidden once a match has started, and the combo tray sits below the hand cards.
- All non-`Production Crash` cards can be selected into the combo tray, while turn-playable actions still use the same confirm-to-play flow.
- Card selections clear automatically when your turn ends.
- The room panel now exposes an in-match `Leave Room` button after the game has started.
- The match board now uses shorter stack placeholders, shorter hand cards, and a shorter incident log with internal scrolling.
- Incident log entries are intentionally compact so more recent events stay visible without crowding the board.
- The incident log now allows a taller visible area and wraps its header controls so titles and buttons do not clip on narrower layouts.
- The discard pile now renders as a stacked visual pile instead of showing the top card description text.
- Hand tiles are art-first and do not repeat the card name/description below the artwork.
- Hand-tile artwork is intentionally enlarged so the illustrated card face remains the primary readable element.
- Hand-card grid width and tile height were increased again so the card artwork reads comfortably without the removed text block.
- The hand now renders as the actual card faces with only minimal count/selection overlays instead of tag/icon placeholder chips.
- Hand cards explicitly pin to the top of the grid and keep full opacity when not playable so the row still reads as a clean set of aligned card faces.
- The `5 Different Tools` combo now uses the discard pile itself as the interaction point and opens a full discard-browser overlay for choosing the reclaim target.
- `Rubber Duck` and the `Mechanical Keyboard` slot keep custom horizontal positioning, but no longer render smaller than the rest of the deck.

## Deployment Notes

- Suitable for a single-instance Render / VM / Docker deployment.
- Avoid horizontal scaling until room state is moved out of memory.
- Docker support already exists in [Dockerfile](Dockerfile).

## Recent Changes

- Renamed the app branding to `Exploding Productions`.
- Added illustrated card art for themed cards.
- Added URL-based room persistence and same-browser reconnect support.
- Compact the room join/create panel after a live match starts.
- Updated `Sprint Planning` so it no longer skips the acting player's turn-ending draw.
- Reduced hand-card density and added visual feedback for draws and action cards.
- Compressed the board, log, and hand card sizing to fit more of the match on screen at once.
- Split the frontend into a lobby page and a dedicated room page.
- Added discard recycling back into the deck to extend rounds.
- Added restart-match reuse for finished rooms via the existing host start control.
- Added auto-target behavior for steals when only one opponent remains available.
- Stabilized the hand grid so fewer cards no longer expand and resize unpredictably.
- Allowed turn-playable action cards to be used in pair/trio/five combos through a confirm-to-play hand flow.
- Rebalanced recycled decks so Production Crash and Blame The Intern counts normalize when the draw pile is rebuilt.
