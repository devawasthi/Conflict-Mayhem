# Project Context

This file is the quick-reference notes file for the project. Update it whenever game rules, room flow, deployment behavior, UI structure, or major assets change.

## Product

- Name: `Exploding Productions`
- Type: browser-based multiplayer card game
- Theme: comedic tech / coding chaos
- Transport: custom Python WebSocket server with static file hosting

## Runtime

- Entry server: [server.py](server.py)
- Client UI: [index.html](index.html)
- Client logic: [client.js](client.js)
- Styling: [styles.css](styles.css)
- Default local URL: `http://localhost:8765`
- Health endpoint: `/health`

## Core Game Rules

- Each player starts with `1` `Blame The Intern` and `5` random cards.
- A turn normally ends with a draw.
- `Revert Commit` is the only action card that skips the turn-ending draw.
- `Pager Alert` gives the next player `+1` required draw, but the acting player still draws to end their own turn.
- `Nope` cancels the latest action or combo unless another `Nope` flips it back.
- Drawing `Production Crash` without `Blame The Intern` eliminates the player.
- Drawing `Production Crash` with `Blame The Intern` discards both cards.
- Combo rules:
  - `2` matching tools: steal a random card
  - `3` matching tools: request a specific card
  - `5` different tools: reclaim one discard-pile card

## Card Theme Mapping

- `Production Crash`
- `Blame The Intern`
- `Nope`
- `Peer Review`
- `Revert Commit`
- `Pager Alert`
- `Deploy To Staging`
- `Project Manager`
- `Rubber Duck`
- `Energy Drink`
- `Sticky Note`
- `Mechanical Keyboard`
- `Overflow Tab`

## Multiplayer / Room Behavior

- Room codes are `4` uppercase letters.
- The current room code is appended to the URL as `?room=ABCD`.
- The client stores a per-room reconnect token in `localStorage`.
- Refreshing in the same browser should rejoin the same room seat automatically.
- Explicit `Leave` clears the stored reconnect token for that room.
- During a live match, the room setup controls collapse and the active room panel remains as the primary room-control area.

## Server Notes

- Room state is held in memory inside a single Python process.
- This should run as a single instance unless shared persistent state is added.
- Player reconnection is handled by a per-player session token stored on the client.
- Disconnecting mid-match now preserves the seat for reconnect instead of eliminating the player immediately.

## UI Notes

- Card art lives in `assets/cards/`.
- The incident log is collapsible.
- A `Production Crash` overlay animation appears for crash moments.
- The hand area contains the most convenient turn-ending draw control.

## Deployment Notes

- Suitable for a single-instance Render / VM / Docker deployment.
- Avoid horizontal scaling until room state is moved out of memory.
- Docker support already exists in [Dockerfile](Dockerfile).

## Recent Changes

- Renamed the app branding to `Exploding Productions`.
- Added illustrated card art for themed cards.
- Added URL-based room persistence and same-browser reconnect support.
- Compact the room join/create panel after a live match starts.
- Updated `Pager Alert` so it no longer skips the acting player's turn-ending draw.
