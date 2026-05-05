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
- The game keeps total `Blame The Intern` availability tied to the round player count, while each player still starts with `1` guaranteed copy in hand.
- The draw pile now uses the full normal deck size after setup instead of the temporary `10`-card test cap.
- A turn normally ends with a draw.
- `Skip` is the only action card that skips the turn-ending draw.
- `Sprint Planning` gives the next player `+2` required draws, but the acting player still draws to end their own turn.
- `Nope` cancels the latest action or combo unless another `Nope` flips it back.
- Drawing `Production Crash` without `Blame The Intern` eliminates the player.
- Drawing `Production Crash` with `Blame The Intern` discards the mitt, and the server can re-queue the crash if the deck would otherwise go crash-free.
- Production Crash pressure scales with the number of alive players, and the deck should never stay at `0` Production Crashes while more than one player is still alive.
- If the draw deck runs out and there are used cards in the discard pile, the discard pile is shuffled back into the deck instead of immediately ending the round.
- If both the draw deck and discard pile run dry before one player remains, the server creates a short sudden-death deck instead of awarding an arbitrary winner.
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
- During a live match, the room access controls collapse and the `Current Room` panel is hidden so gameplay stays in focus.

## Server Notes

- Room state is held in memory inside a single Python process.
- This should run as a single instance unless shared persistent state is added.
- Player reconnection is handled by a per-player session token stored on the client.
- Disconnecting mid-match preserves the seat briefly, but players are auto-eliminated if they do not reconnect within the server grace period.

## UI Notes

- Card art lives in `assets/cards/`.
- The live deck should use the consistent illustrated `Git Rekt`-style card-art set; avoid mixing in unrelated standalone images for individual cards.
- The card-art mappings should stay aligned with the current filenames in `assets/cards/`, including `skip.webp`, `shuffle.webp`, `sprint-planning.webp`, `coffee-break.webp`, `mechanical-keyboard.webp`, and `posh-training.webp`.
- The incident log is always scrollable, defaults to the latest visible entries, and no longer uses a `Show Full Log` expand/collapse control.
- A `Production Crash` overlay animation appears for crash moments.
- Draws and action plays now use a lightweight animated moment overlay.
- Random steals and requested-card transfers now trigger the same card-gain moment treatment so the gained card is visible immediately.
- Losing a card to a random steal now triggers a stronger alert-style popup for the victim, so the interaction is visible instead of feeling silent.
- `Peer Review` now opens a private reveal panel showing the next three cards.
- The live room now uses a simplified three-panel play row: `Engineering Team` on the left, `Toolbox Cards` in the center, and the `Incident Log` on the right.
- The old board-state panel has been removed from the live room. `Deck & Discard` now live in their own right-rail panel above the `Incident Log`, and the discard pile is opened as a popup only when needed.
- Before the host starts the match, `Engineering Team`, `Deck & Discard`, and `Incident Log` stay hidden so the room screen remains focused on joining and the hand area.
- Before the host starts the match, `Current Room` stays on the same top row as `Room access`, while the live-play side panels remain hidden.
- Those live-play side panels are also marked `hidden` in the initial room HTML so they do not flash briefly before the room script applies state.
- The room hero now keeps the same title treatment before and after the match starts, while the separate room-access card is still hidden during live play.
- The compact live-room hero is intentionally very slim so it behaves like a top utility bar instead of a landing-page banner.
- The live-room header now uses a centered stylized wordmark without a boxed title container, and the in-room `Leave Room` action sits next to the connection badge.
- The standalone action-prompt panel has been removed; interactive prompts like reactions, target selection, and crash placement now render inline inside the action tray.
- The draw control is fused into the combo tray as part of the same action area rather than living in a separate section.
- The action tray is now sticky near the bottom of the hand area so draw/combo controls stay accessible while scrolling the room.
- All non-`Production Crash` cards can be selected into the combo tray, while turn-playable actions still use the same confirm-to-play flow.
- Card selections clear automatically when your turn ends.
- The room panel now exposes an in-match `Leave Room` button after the game has started.
- The match board now uses shorter stack placeholders, shorter hand cards, and a shorter incident log with internal scrolling.
- Incident log entries are intentionally compact so more recent events stay visible without crowding the board.
- Incident log items now use tighter padding and smaller type to increase visible history density, with the visible log window capped to roughly the latest five entries before scrolling.
- The `Your hand` card count now sits inline with the hand label instead of floating to the far edge of the panel.
- The hand summary now uses a visual readiness meter so the current card count reads like a compact status component instead of plain text.
- The hand summary count is now styled as a compact `cards in hand` status instead of a large pill badge.
- The incident log now allows a taller visible area and wraps its header controls so titles and buttons do not clip on narrower layouts.
- The discard pile is no longer shown inline on the board; it opens in the discard-browser popup for both browsing and reclaim interactions.
- The deck/discard card keeps the discard helper copy aligned to the card width so empty-state messaging does not drift outside the panel.
- Hand tiles are art-first and do not repeat the card name/description below the artwork.
- Hand cards now reveal the tag, name, and card text on hover/focus so the art-first layout still keeps rules readable.
- Duplicate hand cards now render as a slight stacked fan, and hovering them pushes the extra copy outward so pairs are easier to read at a glance.
- Hand-tile artwork is intentionally enlarged so the illustrated card face remains the primary readable element.
- Hand-card grid width and tile height were increased again so the card artwork reads comfortably without the removed text block.
- The hand now renders as the actual card faces with only minimal count/selection overlays instead of tag/icon placeholder chips.
- Card-count pills are intentionally more prominent than before, and the three live panels are separated with subtle vertical dividers during active play.
- The discard-browser popup uses fixed card widths so discard cards keep a stable size even when the pile is small.
- Hand cards explicitly pin to the top of the grid and keep full opacity when not playable so the row still reads as a clean set of aligned card faces.
- `count-pill`, `selected-pill`, and the fused draw-action tray should stay in the same cool accent family for visual consistency.
- The `5 Different Tools` combo now uses the discard pile itself as the interaction point and opens a full discard-browser overlay for choosing the reclaim target.
- `Rubber Duck` and the `Mechanical Keyboard` slot keep custom horizontal positioning, but no longer render smaller than the rest of the deck.

## Deployment Notes

- Suitable for a single-instance Render / VM / Docker deployment.
- Avoid horizontal scaling until room state is moved out of memory.
- Docker support already exists in [Dockerfile](Dockerfile).
- `index.html` and `room.html` are now served as lightweight templates so JS/CSS asset URLs receive an automatic version query string from the server on each new build/restart.

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
- Added disconnect grace handling, sudden-death deck fallback, alive-player deck normalization, and randomized starting player selection to reduce stalls and repetitive rounds.
- Added restart-match reuse for finished rooms via the existing host start control.
- Added auto-target behavior for steals when only one opponent remains available.
- Stabilized the hand grid so fewer cards no longer expand and resize unpredictably.
- Allowed turn-playable action cards to be used in pair/trio/five combos through a confirm-to-play hand flow.
- Rebalanced recycled decks so Production Crash and Blame The Intern counts normalize when the draw pile is rebuilt.
- Hardened room recovery after refresh/network blips by auto-retrying same-session reconnects and ignoring stale socket disconnects after a session is reclaimed.
