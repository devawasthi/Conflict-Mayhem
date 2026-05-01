import base64
import hashlib
import json
import os
import random
import socket
import struct
import threading
import uuid
from collections import Counter
from dataclasses import dataclass, field
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit


HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8765"))
BASE_DIR = Path(__file__).resolve().parent
WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_LOG_ENTRIES = 30
MAX_ROOM_SIZE = 6

SNACK_KEYS = ["cookie", "donut", "pretzel", "popcorn", "candy"]
DISPLAY_ORDER = [
    "hotPotato",
    "ovenMitt",
    "nope",
    "peek",
    "skip",
    "attack",
    "mixUp",
    "swipe",
    *SNACK_KEYS,
]
REQUESTABLE_KEYS = [key for key in DISPLAY_ORDER if key != "hotPotato"]

CARD_CATALOG = {
    "hotPotato": {
        "name": "Production Crash",
        "tag": "Incident",
        "description": "Draw this without a defuse and your release is over.",
        "themeClass": "theme-danger",
        "group": "hazard",
        "turnPlayable": False,
        "needsTarget": False,
    },
    "ovenMitt": {
        "name": "Blame The Intern",
        "tag": "Defuse",
        "description": "Automatically saves you from a Production Crash, then both cards are discarded.",
        "themeClass": "theme-stabilizer",
        "group": "safety",
        "turnPlayable": False,
        "needsTarget": False,
    },
    "nope": {
        "name": "Nope",
        "tag": "Reaction",
        "description": "Cancel the latest action or combo unless someone Nopes the Nope.",
        "themeClass": "theme-nope",
        "group": "reaction",
        "turnPlayable": False,
        "needsTarget": False,
    },
    "peek": {
        "name": "Peer Review",
        "tag": "Action",
        "description": "Privately inspect the next three cards in the release queue.",
        "themeClass": "theme-peek",
        "group": "action",
        "turnPlayable": True,
        "needsTarget": False,
    },
    "skip": {
        "name": "Revert Commit",
        "tag": "Action",
        "description": "End your turn immediately without drawing.",
        "themeClass": "theme-skip",
        "group": "action",
        "turnPlayable": True,
        "needsTarget": False,
    },
    "attack": {
        "name": "Pager Alert",
        "tag": "Action",
        "description": "Force the next player to take an extra draw. You still draw to end your turn.",
        "themeClass": "theme-attack",
        "group": "action",
        "turnPlayable": True,
        "needsTarget": False,
    },
    "mixUp": {
        "name": "Deploy To Staging",
        "tag": "Action",
        "description": "Shuffle the deck and hope staging catches the problem.",
        "themeClass": "theme-mix",
        "group": "action",
        "turnPlayable": True,
        "needsTarget": False,
    },
    "swipe": {
        "name": "Project Manager",
        "tag": "Action",
        "description": "Choose a player and steal a random card from their hand.",
        "themeClass": "theme-swipe",
        "group": "action",
        "turnPlayable": True,
        "needsTarget": True,
    },
    "cookie": {
        "name": "Rubber Duck",
        "tag": "Desk Loot",
        "description": "Match tech loot cards to unlock combo plays.",
        "themeClass": "theme-cookie",
        "group": "snack",
        "turnPlayable": False,
        "needsTarget": False,
    },
    "donut": {
        "name": "Energy Drink",
        "tag": "Desk Loot",
        "description": "Pairs, trios, and five different tools unlock combo actions.",
        "themeClass": "theme-donut",
        "group": "snack",
        "turnPlayable": False,
        "needsTarget": False,
    },
    "pretzel": {
        "name": "Sticky Note",
        "tag": "Desk Loot",
        "description": "Collect matching tools to trigger stronger combo effects.",
        "themeClass": "theme-pretzel",
        "group": "snack",
        "turnPlayable": False,
        "needsTarget": False,
    },
    "popcorn": {
        "name": "Mechanical Keyboard",
        "tag": "Desk Loot",
        "description": "Single tool cards are harmless alone but powerful in combos.",
        "themeClass": "theme-popcorn",
        "group": "snack",
        "turnPlayable": False,
        "needsTarget": False,
    },
    "candy": {
        "name": "Overflow Tab",
        "tag": "Desk Loot",
        "description": "Five different tools can reclaim a card from the discard pile.",
        "themeClass": "theme-candy",
        "group": "snack",
        "turnPlayable": False,
        "needsTarget": False,
    },
}


def sanitize_name(value: str) -> str:
    cleaned = " ".join((value or "").strip().split())
    return cleaned[:24] or f"Player-{random.randint(100, 999)}"


def sanitize_room_code(value: str) -> str:
    return "".join(character for character in (value or "").upper() if character.isalpha())[:6]


def sanitize_session_token(value: Optional[str]) -> str:
    token = "".join(character for character in (value or "").strip() if character.isalnum())
    return token[:64]


def make_card_payload(card_key: str) -> dict:
    card = CARD_CATALOG[card_key]
    return {
        "key": card_key,
        "name": card["name"],
        "tag": card["tag"],
        "description": card["description"],
        "themeClass": card["themeClass"],
        "group": card["group"],
        "turnPlayable": card["turnPlayable"],
        "needsTarget": card["needsTarget"],
        "isSnack": card["group"] == "snack",
    }


@dataclass
class Player:
    id: str
    session_token: str
    name: str
    connection: Optional["WebSocketConnection"]
    hand: list[str] = field(default_factory=list)
    alive: bool = True
    connected: bool = True
    required_draws: int = 1

    @property
    def oven_mitts(self) -> int:
        return self.hand.count("ovenMitt")


class WebSocketConnection:
    def __init__(self, handler):
        self.socket = handler.connection
        self.socket.settimeout(None)
        self.send_lock = threading.Lock()
        self.room_code: Optional[str] = None
        self.player_id: Optional[str] = None
        self.closed = False

    @classmethod
    def accept(cls, handler):
        key = handler.headers.get("Sec-WebSocket-Key")
        if not key:
            raise ValueError("Missing Sec-WebSocket-Key header.")

        accept = base64.b64encode(
            hashlib.sha1(f"{key}{WEBSOCKET_GUID}".encode("utf-8")).digest()
        ).decode("utf-8")

        handler.send_response(101, "Switching Protocols")
        handler.send_header("Upgrade", "websocket")
        handler.send_header("Connection", "Upgrade")
        handler.send_header("Sec-WebSocket-Accept", accept)
        handler.end_headers()
        return cls(handler)

    def read_exact(self, length: int) -> bytes:
        chunks = bytearray()
        while len(chunks) < length:
            packet = self.socket.recv(length - len(chunks))
            if not packet:
                raise ConnectionError("Socket closed during frame read.")
            chunks.extend(packet)
        return bytes(chunks)

    def read_text(self) -> Optional[str]:
        while True:
            header = self.read_exact(2)
            first, second = header
            opcode = first & 0x0F
            masked = bool(second & 0x80)
            payload_length = second & 0x7F

            if payload_length == 126:
                payload_length = struct.unpack("!H", self.read_exact(2))[0]
            elif payload_length == 127:
                payload_length = struct.unpack("!Q", self.read_exact(8))[0]

            mask = self.read_exact(4) if masked else b""
            payload = self.read_exact(payload_length) if payload_length else b""

            if masked:
                payload = bytes(
                    byte ^ mask[index % 4] for index, byte in enumerate(payload)
                )

            if opcode == 0x8:
                return None
            if opcode == 0x9:
                self.send_frame(payload, opcode=0xA)
                continue
            if opcode != 0x1:
                continue

            return payload.decode("utf-8")

    def send_frame(self, payload: bytes, opcode: int = 0x1) -> None:
        if self.closed:
            return

        header = bytearray()
        header.append(0x80 | opcode)

        length = len(payload)
        if length < 126:
            header.append(length)
        elif length < (1 << 16):
            header.append(126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(127)
            header.extend(struct.pack("!Q", length))

        with self.send_lock:
            self.socket.sendall(bytes(header) + payload)

    def send_json(self, payload: dict) -> None:
        self.send_frame(json.dumps(payload, separators=(",", ":")).encode("utf-8"))

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.send_frame(b"", opcode=0x8)
        except OSError:
            pass
        try:
            self.socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self.socket.close()
        except OSError:
            pass


class GameRoom:
    def __init__(self, code: str):
        self.code = code
        self.players: list[Player] = []
        self.host_id: Optional[str] = None
        self.started = False
        self.winner_id: Optional[str] = None
        self.current_player_id: Optional[str] = None
        self.pending_reinsert_player_id: Optional[str] = None
        self.pending_effect: Optional[dict] = None
        self.deck: list[str] = []
        self.discard: list[str] = []
        self.log_entries: list[str] = []

    def connected_players(self) -> list[Player]:
        return [player for player in self.players if player.connected]

    def alive_players(self) -> list[Player]:
        return [player for player in self.players if player.alive]

    def get_player(self, player_id: Optional[str]) -> Optional[Player]:
        for player in self.players:
            if player.id == player_id:
                return player
        return None

    def get_player_by_session_token(self, session_token: str) -> Optional[Player]:
        if not session_token:
            return None
        for player in self.players:
            if player.session_token == session_token:
                return player
        return None

    def add_log(self, message: str) -> None:
        self.log_entries.append(message)
        self.log_entries = self.log_entries[-MAX_LOG_ENTRIES:]

    def order_after(
        self, player_id: Optional[str], exclude_id: Optional[str] = None, require_nope: bool = False
    ) -> list[str]:
        order = [player.id for player in self.players if player.connected and player.alive]
        if not order:
            return []

        if player_id in order:
            start = (order.index(player_id) + 1) % len(order)
        else:
            start = 0

        result = []
        for offset in range(len(order)):
            candidate_id = order[(start + offset) % len(order)]
            if candidate_id == exclude_id:
                continue
            player = self.get_player(candidate_id)
            if not player:
                continue
            if require_nope and "nope" not in player.hand:
                continue
            result.append(candidate_id)
        return result

    def ensure_host(self) -> None:
        connected = self.connected_players()
        self.host_id = connected[0].id if connected else None

    def attach_player_connection(self, player: Player, connection: WebSocketConnection) -> None:
        player.connection = connection
        player.connected = True
        connection.player_id = player.id
        connection.room_code = self.code

    def add_player(
        self, connection: WebSocketConnection, name: str, session_token: Optional[str] = None
    ) -> Player:
        player = Player(
            id=uuid.uuid4().hex[:8],
            session_token=session_token or uuid.uuid4().hex,
            name=name,
            connection=None,
        )
        self.players.append(player)
        if not self.host_id:
            self.host_id = player.id
        self.attach_player_connection(player, connection)
        self.add_log(f"{player.name} joined room {self.code}.")
        return player

    def reconnect_player(
        self, connection: WebSocketConnection, name: str, session_token: str
    ) -> Optional[Player]:
        player = self.get_player_by_session_token(session_token)
        if not player:
            return None
        if player.connected:
            raise ValueError("That player is already connected in another tab.")

        player.name = name or player.name
        self.attach_player_connection(player, connection)
        if not self.host_id:
            self.host_id = player.id
        self.add_log(f"{player.name} rejoined room {self.code}.")
        return player

    def build_deck(self) -> list[str]:
        cards: list[str] = []
        cards.extend(["nope"] * 5)
        cards.extend(["peek"] * 4)
        cards.extend(["skip"] * 4)
        cards.extend(["attack"] * 4)
        cards.extend(["mixUp"] * 4)
        cards.extend(["swipe"] * 4)
        cards.extend(["ovenMitt"] * 5)
        for snack_key in SNACK_KEYS:
            cards.extend([snack_key] * 4)
        random.shuffle(cards)
        return cards

    def start_game(self) -> None:
        self.players = [player for player in self.players if player.connected]
        if len(self.players) < 2:
            raise ValueError("At least two players are required to start.")

        self.started = True
        self.winner_id = None
        self.pending_reinsert_player_id = None
        self.pending_effect = None
        self.discard = []
        self.log_entries = []
        self.deck = self.build_deck()

        for player in self.players:
            player.alive = True
            player.required_draws = 1
            player.hand = ["ovenMitt"]

        for _ in range(5):
            for player in self.players:
                player.hand.append(self.deck.pop())

        hazards = max(1, len(self.players) - 1)
        self.deck.extend(["hotPotato"] * hazards)
        random.shuffle(self.deck)

        self.current_player_id = self.players[0].id
        self.add_log("A new Exploding Productions match began.")

    def leave_player(self, player_id: str) -> bool:
        player = self.get_player(player_id)
        if not player:
            return not self.connected_players()

        player.connected = False
        if player.connection:
            player.connection.room_code = None
            player.connection.player_id = None
        player.connection = None
        player.session_token = ""

        if not self.started:
            self.players = [item for item in self.players if item.id != player.id]
            self.add_log(f"{player.name} left the lobby.")
            self.ensure_host()
            return not self.players

        self.cleanup_pending_for_departure(player.id)

        if player.alive:
            self.eliminate_player(player, reason="leave")
        else:
            self.add_log(f"{player.name} left the room.")

        self.ensure_host()
        return not self.connected_players()

    def disconnect_player(self, player_id: str) -> bool:
        player = self.get_player(player_id)
        if not player:
            return False

        player.connected = False
        if player.connection:
            player.connection.room_code = None
            player.connection.player_id = None
        player.connection = None

        if not self.started:
            self.add_log(f"{player.name} disconnected from the lobby.")
            self.ensure_host()
            return False

        if player.alive:
            self.add_log(f"{player.name} disconnected. Their seat is reserved until they reconnect.")
        else:
            self.add_log(f"{player.name} disconnected after being eliminated.")

        self.ensure_host()
        return False

    def cleanup_pending_for_departure(self, player_id: str) -> None:
        if self.pending_reinsert_player_id == player_id:
            self.pending_reinsert_player_id = None

        if not self.pending_effect:
            return

        effect = self.pending_effect
        if effect["actor_id"] == player_id:
            self.pending_effect = None
            self.add_log(f"{effect['label']} fizzled because its player left.")
            return

        remaining = [
            candidate_id
            for candidate_id in effect["response_queue"]
            if candidate_id != player_id
            and self.get_player(candidate_id)
            and self.get_player(candidate_id).connected
            and self.get_player(candidate_id).alive
            and "nope" in self.get_player(candidate_id).hand
        ]
        effect["response_queue"] = remaining
        effect["response_index"] = 0
        effect["current_responder_id"] = remaining[0] if remaining else None

        if effect["current_responder_id"]:
            responder = self.get_player(effect["current_responder_id"])
            self.add_log(f"{responder.name} may respond with Nope.")
        else:
            if effect["canceled"]:
                self.add_log(f"{effect['label']} was stopped by Nope.")
            else:
                self.resolve_effect(effect)
            self.pending_effect = None

    def assert_turn_player(self, player_id: str) -> Player:
        player = self.get_player(player_id)
        if not player or not player.connected:
            raise ValueError("You are not attached to an active player.")
        if not self.started:
            raise ValueError("The match has not started yet.")
        if self.winner_id:
            raise ValueError("The match has already ended.")
        if self.pending_effect:
            raise ValueError("An action is waiting for Nope responses.")
        if self.pending_reinsert_player_id:
            if self.pending_reinsert_player_id != player_id:
                raise ValueError("Another player must finish resolving the Production Crash first.")
            raise ValueError("Finish resolving the Production Crash before doing anything else.")
        if self.current_player_id != player_id:
            raise ValueError("It is not your turn.")
        if not player.alive:
            raise ValueError("Eliminated players cannot act.")
        return player

    def next_alive_after(self, player_id: Optional[str]) -> Optional[Player]:
        next_ids = self.order_after(player_id)
        return self.get_player(next_ids[0]) if next_ids else None

    def advance_turn(self, from_player_id: str) -> None:
        current = self.get_player(from_player_id)
        if current:
            current.required_draws = 1

        next_player = self.next_alive_after(from_player_id)
        if not next_player:
            return

        self.current_player_id = next_player.id
        self.add_log(f"It is now {next_player.name}'s turn.")

    def eliminate_player(self, player: Player, reason: str) -> None:
        player.alive = False
        player.required_draws = 1
        self.discard.extend(player.hand)
        player.hand.clear()
        self.pending_reinsert_player_id = None

        if self.pending_effect and self.pending_effect["actor_id"] == player.id:
            self.pending_effect = None

        alive = self.alive_players()
        if len(alive) == 1:
            self.winner_id = alive[0].id
            self.current_player_id = alive[0].id
            self.add_log(f"{alive[0].name} wins the match.")
            return

        if reason == "hotPotato":
            self.add_log(f"{player.name} was knocked out by a Production Crash.")
        elif reason == "disconnect":
            self.add_log(f"{player.name} is out because they left the table.")
        elif reason == "leave":
            self.add_log(f"{player.name} left the match and is out.")

        if self.current_player_id == player.id:
            next_player = self.next_alive_after(player.id)
            self.current_player_id = next_player.id if next_player else None
            if next_player:
                self.add_log(f"The turn passes to {next_player.name}.")

    def remove_cards(self, player: Player, card_key: str, count: int) -> None:
        if player.hand.count(card_key) < count:
            raise ValueError(f"You do not have {count} copies of {CARD_CATALOG[card_key]['name']}.")
        for _ in range(count):
            player.hand.remove(card_key)

    def validate_target(self, actor_id: str, target_id: Optional[str]) -> Player:
        target = self.get_player(target_id)
        if not target or not target.connected or not target.alive or target.id == actor_id:
            raise ValueError("Choose a valid live opponent.")
        return target

    def start_effect(self, effect: dict) -> list[tuple[WebSocketConnection, dict]]:
        actor = self.get_player(effect["actor_id"])
        self.add_log(f"{actor.name} played {effect['label']}.")

        responders = self.order_after(effect["actor_id"], exclude_id=effect["actor_id"], require_nope=True)
        if responders:
            effect["response_queue"] = responders
            effect["response_index"] = 0
            effect["current_responder_id"] = responders[0]
            effect["canceled"] = False
            self.pending_effect = effect
            responder = self.get_player(responders[0])
            self.add_log(f"{responder.name} may respond with Nope.")
            return []

        messages = self.resolve_effect(effect)
        return self.maybe_draw_after_effect(effect, messages)

    def maybe_draw_after_effect(
        self, effect: dict, messages: list[tuple[WebSocketConnection, dict]]
    ) -> list[tuple[WebSocketConnection, dict]]:
        if not effect.get("auto_draw_after"):
            return messages

        actor = self.get_player(effect["actor_id"])
        if not actor or not actor.connected or not actor.alive:
            return messages
        if self.winner_id or self.pending_reinsert_player_id or self.pending_effect:
            return messages
        if self.current_player_id != actor.id:
            return messages

        self.add_log(f"{actor.name} now draws to end the turn.")
        messages.extend(self.draw_card(actor.id))
        return messages

    def finalize_pending_effect(self) -> list[tuple[WebSocketConnection, dict]]:
        if not self.pending_effect:
            return []

        effect = self.pending_effect
        self.pending_effect = None

        if effect["canceled"]:
            self.add_log(f"{effect['label']} was stopped by Nope.")
            return self.maybe_draw_after_effect(effect, [])

        messages = self.resolve_effect(effect)
        return self.maybe_draw_after_effect(effect, messages)

    def respond_nope(self, player_id: str, play_nope: bool) -> list[tuple[WebSocketConnection, dict]]:
        if not self.pending_effect:
            raise ValueError("There is no action waiting for a Nope.")

        effect = self.pending_effect
        if effect["current_responder_id"] != player_id:
            raise ValueError("It is not your turn to respond.")

        player = self.get_player(player_id)
        if not player or not player.connected or not player.alive:
            raise ValueError("You cannot respond right now.")

        if play_nope:
            if "nope" not in player.hand:
                raise ValueError("You do not have a Nope card.")

            player.hand.remove("nope")
            self.discard.append("nope")
            effect["canceled"] = not effect["canceled"]
            self.add_log(f"{player.name} played Nope.")

            responders = self.order_after(player.id, exclude_id=player.id, require_nope=True)
            if responders:
                effect["response_queue"] = responders
                effect["response_index"] = 0
                effect["current_responder_id"] = responders[0]
                responder = self.get_player(responders[0])
                self.add_log(f"{responder.name} may respond with Nope.")
                return []

            return self.finalize_pending_effect()

        effect["response_index"] += 1
        if effect["response_index"] < len(effect["response_queue"]):
            effect["current_responder_id"] = effect["response_queue"][effect["response_index"]]
            responder = self.get_player(effect["current_responder_id"])
            self.add_log(f"{responder.name} may respond with Nope.")
            return []

        return self.finalize_pending_effect()

    def play_card(
        self, player_id: str, card_key: Optional[str], target_id: Optional[str]
    ) -> list[tuple[WebSocketConnection, dict]]:
        if not card_key or card_key not in CARD_CATALOG:
            raise ValueError("That card does not exist.")

        player = self.assert_turn_player(player_id)
        card = CARD_CATALOG[card_key]

        if card_key not in player.hand:
            raise ValueError("That card is not in your hand.")
        if not card["turnPlayable"]:
            raise ValueError("That card cannot be played on your turn.")

        if card["needsTarget"]:
            self.validate_target(player.id, target_id)

        self.remove_cards(player, card_key, 1)
        self.discard.append(card_key)

        effect = {
            "actor_id": player.id,
            "kind": card_key,
            "label": card["name"],
            "target_id": target_id,
            "requested_key": None,
            "discard_key": None,
            "auto_draw_after": card_key != "skip",
            "response_queue": [],
            "response_index": 0,
            "current_responder_id": None,
            "canceled": False,
        }
        return self.start_effect(effect)

    def play_combo(
        self,
        player_id: str,
        combo_type: str,
        card_key: Optional[str],
        target_id: Optional[str],
        requested_key: Optional[str],
        discard_key: Optional[str],
        card_keys: Optional[list[str]],
    ) -> list[tuple[WebSocketConnection, dict]]:
        player = self.assert_turn_player(player_id)

        if combo_type == "pair":
            if card_key not in SNACK_KEYS:
                raise ValueError("A pair must use matching tech-item cards.")
            self.remove_cards(player, card_key, 2)
            self.discard.extend([card_key, card_key])
            self.validate_target(player.id, target_id)
            effect = {
                "actor_id": player.id,
                "kind": "pair",
                "label": "2 Matching Tools",
                "target_id": target_id,
                "requested_key": None,
                "discard_key": None,
                "combo_card_key": card_key,
                "auto_draw_after": True,
                "response_queue": [],
                "response_index": 0,
                "current_responder_id": None,
                "canceled": False,
            }
            return self.start_effect(effect)

        if combo_type == "trio":
            if card_key not in SNACK_KEYS:
                raise ValueError("A trio must use matching tech-item cards.")
            if requested_key not in REQUESTABLE_KEYS:
                raise ValueError("Choose a valid card to request.")
            self.remove_cards(player, card_key, 3)
            self.discard.extend([card_key, card_key, card_key])
            self.validate_target(player.id, target_id)
            effect = {
                "actor_id": player.id,
                "kind": "trio",
                "label": "3 Matching Tools",
                "target_id": target_id,
                "requested_key": requested_key,
                "discard_key": None,
                "combo_card_key": card_key,
                "auto_draw_after": True,
                "response_queue": [],
                "response_index": 0,
                "current_responder_id": None,
                "canceled": False,
            }
            return self.start_effect(effect)

        if combo_type == "five":
            if not isinstance(card_keys, list):
                raise ValueError("Choose five different tech-item cards.")
            selected = [key for key in card_keys if key in SNACK_KEYS]
            if len(selected) != 5 or len(set(selected)) != 5:
                raise ValueError("The five-different combo needs five different tech-item cards.")
            for snack_key in selected:
                self.remove_cards(player, snack_key, 1)
            self.discard.extend(selected)
            if not discard_key or discard_key == "hotPotato":
                raise ValueError("Choose a valid discard pile card to reclaim.")
            if discard_key not in self.discard:
                raise ValueError("That discard pile card is no longer available.")
            effect = {
                "actor_id": player.id,
                "kind": "five",
                "label": "5 Different Tools",
                "target_id": None,
                "requested_key": None,
                "discard_key": discard_key,
                "combo_card_key": None,
                "auto_draw_after": True,
                "response_queue": [],
                "response_index": 0,
                "current_responder_id": None,
                "canceled": False,
            }
            return self.start_effect(effect)

        raise ValueError("Unknown combo type.")

    def draw_card(self, player_id: str) -> list[tuple[WebSocketConnection, dict]]:
        player = self.assert_turn_player(player_id)
        if not self.deck:
            winner = next((other for other in self.alive_players() if other.id != player.id), None)
            if winner:
                self.winner_id = winner.id
                self.current_player_id = winner.id
                self.add_log(f"The deck ran dry. {winner.name} wins by survival.")
            return []

        drawn = self.deck.pop()
        messages: list[tuple[WebSocketConnection, dict]] = []

        if drawn == "hotPotato":
            if "ovenMitt" not in player.hand:
                self.discard.append("hotPotato")
                self.eliminate_player(player, reason="hotPotato")
                return messages

            player.hand.remove("ovenMitt")
            self.discard.append("hotPotato")
            self.discard.append("ovenMitt")
            player.required_draws = max(0, player.required_draws - 1)
            self.add_log(f"{player.name} neutralized a Production Crash by blaming the intern.")
            messages.append(
                (
                    player.connection,
                    {
                        "type": "info",
                        "message": "You neutralized a Production Crash. Both the crash and Blame The Intern were discarded.",
                    },
                )
            )

            if player.required_draws == 0:
                self.advance_turn(player.id)
            return messages

        player.hand.append(drawn)
        player.required_draws = max(0, player.required_draws - 1)
        self.add_log(f"{player.name} drew a card.")
        messages.append(
            (
                player.connection,
                {"type": "info", "message": f"You drew {CARD_CATALOG[drawn]['name']}."},
            )
        )

        if player.required_draws == 0:
            self.advance_turn(player.id)

        return messages

    def choose_reinsert(self, player_id: str, placement: str) -> None:
        if self.pending_reinsert_player_id != player_id:
            raise ValueError("You do not have a Production Crash waiting to be reinserted.")

        if placement == "top":
            index = len(self.deck)
        elif placement == "middle":
            index = len(self.deck) // 2
        elif placement == "bottom":
            index = 0
        elif placement == "random":
            index = random.randint(0, len(self.deck))
        else:
            raise ValueError("Unknown reinsert position.")

        self.deck.insert(index, "hotPotato")
        player = self.get_player(player_id)
        self.pending_reinsert_player_id = None
        self.add_log(f"{player.name} tucked the Production Crash back into the deck.")

        if player and player.required_draws == 0:
            self.advance_turn(player.id)

    def steal_random_card(
        self, actor: Player, target: Player, source_label: str
    ) -> list[tuple[WebSocketConnection, dict]]:
        stealable = [card for card in target.hand if card != "hotPotato"]
        if not stealable:
            self.add_log(f"{source_label} fizzled because {target.name} had nothing to steal.")
            return []

        stolen = random.choice(stealable)
        target.hand.remove(stolen)
        actor.hand.append(stolen)
        self.add_log(f"{actor.name} stole a card from {target.name}.")
        return [
            (
                actor.connection,
                {"type": "info", "message": f"You stole {CARD_CATALOG[stolen]['name']}."},
            ),
            (
                target.connection,
                {"type": "info", "message": f"{actor.name} stole one of your cards."},
            ),
        ]

    def resolve_effect(self, effect: dict) -> list[tuple[WebSocketConnection, dict]]:
        actor = self.get_player(effect["actor_id"])
        if not actor or not actor.connected or not actor.alive:
            return []

        kind = effect["kind"]
        messages: list[tuple[WebSocketConnection, dict]] = []

        if kind == "peek":
            preview = self.deck[-3:]
            names = ", ".join(CARD_CATALOG[item]["name"] for item in reversed(preview)) or "nothing"
            self.add_log(f"{actor.name} completed a Peer Review.")
            messages.append(
                (
                    actor.connection,
                    {
                        "type": "peer_review_result",
                        "message": f"Peer Review shows: {names}.",
                        "cards": [make_card_payload(item) for item in reversed(preview)],
                    },
                )
            )
            return messages

        if kind == "skip":
            actor.required_draws = 0
            self.add_log(f"{actor.name} skipped the draw phase.")
            self.advance_turn(actor.id)
            return messages

        if kind == "attack":
            next_player = self.next_alive_after(actor.id)
            if not next_player:
                return messages
            next_player.required_draws += 1
            self.add_log(f"{actor.name} attacked. {next_player.name} must draw {next_player.required_draws} cards.")
            return messages

        if kind == "mixUp":
            random.shuffle(self.deck)
            self.add_log(f"{actor.name} mixed up the deck.")
            return messages

        if kind == "swipe":
            target = self.get_player(effect["target_id"])
            if not target or not target.connected or not target.alive:
                self.add_log("Project Manager fizzled because the target was not available.")
                return messages
            return self.steal_random_card(actor, target, "Project Manager")

        if kind == "pair":
            target = self.get_player(effect["target_id"])
            if not target or not target.connected or not target.alive:
                self.add_log("2 Matching Tools fizzled because the target was not available.")
                return messages
            return self.steal_random_card(actor, target, "2 of a Kind")

        if kind == "trio":
            target = self.get_player(effect["target_id"])
            requested_key = effect["requested_key"]
            if not target or not target.connected or not target.alive:
                self.add_log("3 Matching Tools fizzled because the target was not available.")
                return messages
            if requested_key in target.hand:
                target.hand.remove(requested_key)
                actor.hand.append(requested_key)
                self.add_log(
                    f"{actor.name} requested {CARD_CATALOG[requested_key]['name']} and {target.name} had it."
                )
                return [
                    (
                        actor.connection,
                        {
                            "type": "info",
                            "message": f"You received {CARD_CATALOG[requested_key]['name']} from {target.name}.",
                        },
                    ),
                    (
                        target.connection,
                        {
                            "type": "info",
                            "message": f"You handed {CARD_CATALOG[requested_key]['name']} to {actor.name}.",
                        },
                    ),
                ]

            self.add_log(
                f"{actor.name} requested {CARD_CATALOG[requested_key]['name']}, but {target.name} did not have it."
            )
            return messages

        if kind == "five":
            discard_key = effect["discard_key"]
            if discard_key == "hotPotato":
                self.add_log("5 Different Tools cannot reclaim a Production Crash.")
                return messages

            found_index = None
            for index in range(len(self.discard) - 1, -1, -1):
                if self.discard[index] == discard_key:
                    found_index = index
                    break

            if found_index is None:
                self.add_log("5 Different Tools fizzled because that discard card was gone.")
                return messages

            reclaimed = self.discard.pop(found_index)
            actor.hand.append(reclaimed)
            self.add_log(f"{actor.name} reclaimed {CARD_CATALOG[reclaimed]['name']} from the discard pile.")
            messages.append(
                (
                    actor.connection,
                    {"type": "info", "message": f"You reclaimed {CARD_CATALOG[reclaimed]['name']}."},
                )
            )
            return messages

        return messages

    def hand_payload(self, viewer: Player, can_play: bool) -> list[dict]:
        counts = Counter(viewer.hand)
        groups = []
        for card_key in DISPLAY_ORDER:
            count = counts.get(card_key, 0)
            if count == 0:
                continue
            payload = make_card_payload(card_key)
            payload["count"] = count
            payload["turnPlayable"] = can_play and CARD_CATALOG[card_key]["turnPlayable"]
            payload["selectable"] = can_play and CARD_CATALOG[card_key]["group"] == "snack"
            groups.append(payload)
        return groups

    def discard_choice_payload(self) -> list[dict]:
        seen: set[str] = set()
        choices = []
        for card_key in reversed(self.discard):
            if card_key == "hotPotato" or card_key in seen:
                continue
            seen.add(card_key)
            choices.append(make_card_payload(card_key))
        return choices

    def discard_pile_payload(self) -> list[dict]:
        pile = []
        for offset, card_key in enumerate(reversed(self.discard)):
            payload = make_card_payload(card_key)
            payload["reclaimable"] = card_key != "hotPotato"
            payload["discardIndex"] = offset
            pile.append(payload)
        return pile

    def request_options_payload(self) -> list[dict]:
        return [make_card_payload(card_key) for card_key in REQUESTABLE_KEYS]

    def serialize_for(self, viewer: Player) -> dict:
        current_player = self.get_player(self.current_player_id)
        can_play = (
            self.started
            and not self.winner_id
            and not self.pending_effect
            and self.pending_reinsert_player_id is None
            and self.current_player_id == viewer.id
            and viewer.alive
        )
        can_draw = can_play

        phase_label = "Lobby"
        if self.started and not self.winner_id:
            phase_label = "Release Panic"
        elif self.winner_id:
            phase_label = "Finished"

        turn_label = "Waiting for players"
        if self.winner_id:
            winner = self.get_player(self.winner_id)
            turn_label = f"{winner.name} wins the match"
        elif self.started and current_player:
            if current_player.connected:
                draws = current_player.required_draws
                turn_label = f"{current_player.name}'s turn • {draws} draw{'s' if draws != 1 else ''} remaining"
            else:
                turn_label = f"Waiting for {current_player.name} to reconnect"

        pending_choice = None
        prompt_text = "Wait for another player, then have the host start the match."

        if self.pending_reinsert_player_id == viewer.id:
            pending_choice = {
                "kind": "reinsert",
                "options": [
                    {"value": "top", "label": "Top"},
                    {"value": "middle", "label": "Middle"},
                    {"value": "bottom", "label": "Bottom"},
                    {"value": "random", "label": "Random"},
                ],
            }
            prompt_text = "Choose where to hide the Production Crash."
        elif self.pending_effect:
            effect = self.pending_effect
            responder = self.get_player(effect["current_responder_id"])
            actor = self.get_player(effect["actor_id"])
            if responder and responder.id == viewer.id and "nope" in viewer.hand:
                pending_choice = {
                    "kind": "reaction",
                    "effectLabel": effect["label"],
                    "actorName": actor.name if actor else "Another player",
                }
                prompt_text = f"You can play Nope against {effect['label']}."
            elif actor and actor.id == viewer.id:
                prompt_text = f"Waiting to see whether anyone Nopes your {effect['label']}."
            elif responder:
                prompt_text = f"Waiting for {responder.name} to answer with Nope or pass."
            else:
                prompt_text = f"{effect['label']} is resolving."
        elif self.winner_id:
            prompt_text = "The round is over. The host can start another match."
        elif can_play:
            if viewer.required_draws > 1:
                prompt_text = (
                    f"You need to resolve {viewer.required_draws} draws this turn. "
                    "You can still play one action or combo before drawing."
                )
            else:
                prompt_text = "Play one action or combo, or draw immediately to end your turn."
        elif self.started:
            if current_player and not current_player.connected:
                prompt_text = f"Waiting for {current_player.name} to reconnect before the match continues."
            else:
                prompt_text = "Watch the incident queue and wait for your turn."

        discard_top = None
        if self.discard:
            discard_top = make_card_payload(self.discard[-1])

        return {
            "roomCode": self.code,
            "started": self.started,
            "winnerId": self.winner_id,
            "playerToken": viewer.session_token,
            "phaseLabel": phase_label,
            "turnLabel": turn_label,
            "promptText": prompt_text,
            "canStart": viewer.id == self.host_id and len(self.connected_players()) >= 2 and (not self.started or bool(self.winner_id)),
            "canDraw": can_draw,
            "canPlay": can_play,
            "deckCount": len(self.deck),
            "discardCount": len(self.discard),
            "discardTop": discard_top,
            "discardPile": self.discard_pile_payload(),
            "discardChoices": self.discard_choice_payload(),
            "requestOptions": self.request_options_payload(),
            "players": [
                {
                    "id": player.id,
                    "name": player.name,
                    "handCount": len(player.hand),
                    "stabilizers": player.oven_mitts,
                    "requiredDraws": player.required_draws,
                    "alive": player.alive,
                    "isHost": player.id == self.host_id,
                    "isCurrentTurn": player.id == self.current_player_id and self.started and not self.winner_id,
                    "isYou": player.id == viewer.id,
                }
                for player in self.players
                if player.connected
            ],
            "availableTargets": [
                {"id": player.id, "name": player.name}
                for player in self.players
                if player.connected and player.alive and player.id != viewer.id
            ],
            "hand": self.hand_payload(viewer, can_play),
            "log": self.log_entries[-16:],
            "pendingChoice": pending_choice,
        }

    def broadcast_state(self) -> None:
        for player in list(self.players):
            if not player.connected or not player.connection:
                continue
            try:
                player.connection.send_json({"type": "state", "state": self.serialize_for(player)})
            except OSError:
                player.connected = False


class RoomManager:
    def __init__(self):
        self.rooms: dict[str, GameRoom] = {}
        self.lock = threading.RLock()

    def create_room_code(self) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"
        while True:
            code = "".join(random.choice(alphabet) for _ in range(4))
            if code not in self.rooms:
                return code

    def send_error(self, connection: WebSocketConnection, message: str) -> None:
        try:
            connection.send_json({"type": "error", "message": message})
        except OSError:
            pass

    def send_info(self, connection: WebSocketConnection, message: str) -> None:
        try:
            connection.send_json({"type": "info", "message": message})
        except OSError:
            pass

    def emit_messages(self, messages: list[tuple[WebSocketConnection, dict]]) -> None:
        for target_connection, payload in messages:
            if not target_connection:
                continue
            try:
                target_connection.send_json(payload)
            except OSError:
                pass

    def handle_message(self, connection: WebSocketConnection, payload: str) -> None:
        try:
            message = json.loads(payload)
        except json.JSONDecodeError:
            self.send_error(connection, "Could not parse the message payload.")
            return

        action = message.get("type")

        with self.lock:
            try:
                if action == "create_room":
                    self.create_room(connection, message.get("name", ""))
                elif action == "join_room":
                    self.join_room(
                        connection,
                        message.get("name", ""),
                        message.get("roomCode", ""),
                        message.get("playerToken", ""),
                    )
                elif action == "leave_room":
                    self.leave_room(connection)
                elif action == "start_game":
                    self.start_game(connection)
                elif action == "play_card":
                    self.play_card(connection, message.get("cardKey"), message.get("targetId"))
                elif action == "play_combo":
                    self.play_combo(
                        connection,
                        message.get("comboType"),
                        message.get("cardKey"),
                        message.get("targetId"),
                        message.get("requestedKey"),
                        message.get("discardKey"),
                        message.get("cardKeys"),
                    )
                elif action == "draw_card":
                    self.draw_card(connection)
                elif action == "choose_reinsert":
                    self.choose_reinsert(connection, message.get("placement", ""))
                elif action == "respond_nope":
                    self.respond_nope(connection, bool(message.get("playNope")))
                else:
                    self.send_error(connection, "Unknown action.")
            except ValueError as error:
                self.send_error(connection, str(error))

    def create_room(self, connection: WebSocketConnection, name: str) -> None:
        if connection.room_code:
            raise ValueError("Leave your current room before creating a new one.")

        code = self.create_room_code()
        room = GameRoom(code)
        room.add_player(connection, sanitize_name(name))
        self.rooms[code] = room
        self.send_info(connection, f"Room {code} created. Share the code so someone can join.")
        room.broadcast_state()

    def join_room(
        self, connection: WebSocketConnection, name: str, room_code: str, player_token: str
    ) -> None:
        if connection.room_code:
            raise ValueError("Leave your current room before joining a new one.")

        code = sanitize_room_code(room_code)
        reconnect_token = sanitize_session_token(player_token)
        clean_name = sanitize_name(name)
        room = self.rooms.get(code)
        if not room:
            raise ValueError("That room code was not found.")

        if reconnect_token:
            player = room.reconnect_player(connection, clean_name, reconnect_token)
            if player:
                self.send_info(connection, f"Rejoined room {code}.")
                room.broadcast_state()
                return

        if room.started and not room.winner_id:
            raise ValueError("That room is already in the middle of a match.")
        if len(room.connected_players()) >= MAX_ROOM_SIZE:
            raise ValueError("That room is full.")

        room.add_player(connection, clean_name)
        self.send_info(connection, f"Joined room {code}.")
        room.broadcast_state()

    def leave_room(self, connection: WebSocketConnection) -> None:
        if not connection.room_code:
            connection.send_json({"type": "left_room"})
            return

        room = self.rooms.get(connection.room_code)
        if not room:
            connection.room_code = None
            connection.player_id = None
            connection.send_json({"type": "left_room"})
            return

        empty = room.leave_player(connection.player_id)
        connection.send_json({"type": "left_room"})
        if empty:
            self.rooms.pop(room.code, None)
        else:
            room.broadcast_state()

    def start_game(self, connection: WebSocketConnection) -> None:
        room = self.rooms.get(connection.room_code or "")
        if not room:
            raise ValueError("Join a room before starting a match.")
        if room.host_id != connection.player_id:
            raise ValueError("Only the host can start the match.")

        room.start_game()
        room.broadcast_state()

    def play_card(
        self, connection: WebSocketConnection, card_key: Optional[str], target_id: Optional[str]
    ) -> None:
        room = self.rooms.get(connection.room_code or "")
        if not room:
            raise ValueError("Join a room first.")

        messages = room.play_card(connection.player_id, card_key, target_id)
        self.emit_messages(messages)
        room.broadcast_state()

    def play_combo(
        self,
        connection: WebSocketConnection,
        combo_type: Optional[str],
        card_key: Optional[str],
        target_id: Optional[str],
        requested_key: Optional[str],
        discard_key: Optional[str],
        card_keys: Optional[list[str]],
    ) -> None:
        room = self.rooms.get(connection.room_code or "")
        if not room:
            raise ValueError("Join a room first.")
        if not combo_type:
            raise ValueError("No combo type was provided.")

        messages = room.play_combo(
            connection.player_id,
            combo_type,
            card_key,
            target_id,
            requested_key,
            discard_key,
            card_keys,
        )
        self.emit_messages(messages)
        room.broadcast_state()

    def draw_card(self, connection: WebSocketConnection) -> None:
        room = self.rooms.get(connection.room_code or "")
        if not room:
            raise ValueError("Join a room first.")

        messages = room.draw_card(connection.player_id)
        self.emit_messages(messages)
        room.broadcast_state()

    def choose_reinsert(self, connection: WebSocketConnection, placement: str) -> None:
        room = self.rooms.get(connection.room_code or "")
        if not room:
            raise ValueError("Join a room first.")

        room.choose_reinsert(connection.player_id, placement)
        room.broadcast_state()

    def respond_nope(self, connection: WebSocketConnection, play_nope: bool) -> None:
        room = self.rooms.get(connection.room_code or "")
        if not room:
            raise ValueError("Join a room first.")

        messages = room.respond_nope(connection.player_id, play_nope)
        self.emit_messages(messages)
        room.broadcast_state()

    def disconnect(self, connection: WebSocketConnection) -> None:
        with self.lock:
            room = self.rooms.get(connection.room_code or "")
            if not room or not connection.player_id:
                connection.close()
                return

            removable = room.disconnect_player(connection.player_id)
            if removable:
                self.rooms.pop(room.code, None)
            else:
                room.broadcast_state()
            connection.close()


ROOMS = RoomManager()


class GameRequestHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/ws":
            self.handle_websocket()
            return
        if parsed.path == "/health":
            payload = json.dumps({"ok": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def handle_websocket(self):
        self.close_connection = True
        try:
            connection = WebSocketConnection.accept(self)
        except ValueError as error:
            self.send_error(400, str(error))
            return

        try:
            while True:
                message = connection.read_text()
                if message is None:
                    break
                ROOMS.handle_message(connection, message)
        except (ConnectionError, OSError):
            pass
        finally:
            ROOMS.disconnect(connection)

    def log_message(self, format, *args):
        return


def run() -> None:
    handler = partial(GameRequestHandler, directory=str(BASE_DIR))
    server = ThreadingHTTPServer((HOST, PORT), handler)
    print(f"Exploding Productions running on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Exploding Productions.")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
