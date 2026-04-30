# Merge Conflict Mayhem Online

Merge Conflict Mayhem Online is an original multiplayer browser card game with room codes, real-time WebSocket updates, `Nope` reactions, `Peer Review`, `Revert Commit`, `Deploy To Staging`, `Pager Alert`, and combo rules for `2` matching tools, `3` matching tools, and `5` different tools.

## Run locally

```bash
cd "/Users/devawasthi/Documents/New project"
python3 server.py
```

Then open:

- `http://localhost:8765`

Open that URL in two browser tabs or two different browsers to test multiplayer. One player creates a room, the other joins with the room code, and the host starts the match.

## Rules

- Every player starts with `1` `Blame The Intern` and `5` random cards.
- On your turn, you can either draw immediately or play one action/combo first.
- After most played actions and combos, the game automatically draws the end-of-turn card for you.
- If you draw a `Production Crash` without `Blame The Intern`, you are eliminated.
- If you draw a `Production Crash` with `Blame The Intern`, both cards are discarded.
- `Nope` is a reaction card that cancels the latest action or combo unless another `Nope` flips it back.
- `Revert Commit` ends your turn immediately without the normal draw.
- `Pager Alert` ends your turn without the normal draw and makes the next player take one extra required draw.
- `Peer Review` shows you the next three cards privately.
- `Deploy To Staging` shuffles the deck.
- `Project Manager` steals a random card from a chosen opponent.
- `2` matching tools steals a random card from a chosen opponent.
- `3` matching tools lets you request a specific card from a chosen opponent.
- `5` different tools lets you reclaim one card from the discard pile.

## Deploy

The backend is a single no-dependency Python process, so it can be deployed anywhere Python `3.9+` is available.

Environment variables:

- `HOST` defaults to `0.0.0.0`
- `PORT` defaults to `8765`

Example:

```bash
HOST=0.0.0.0 PORT=8080 python3 server.py
```

Health check endpoint:

- `/health`

## Docker

Build:

```bash
docker build -t merge-conflict-mayhem .
```

Run:

```bash
docker run --rm -p 8765:8765 merge-conflict-mayhem
```
