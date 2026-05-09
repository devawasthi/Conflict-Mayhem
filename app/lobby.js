const PLAYER_NAME_STORAGE_KEY = "exploding-productions-player-name";
const ROOM_TOKEN_STORAGE_PREFIX = "exploding-productions-room-token:";

const state = {
  socket: null,
  socketStatus: "connecting",
  queue: [],
  room: null,
  notice: "",
};

const ui = {
  connectionPill: document.querySelector("#connection-pill"),
  guideBtn: document.querySelector("#guide-btn"),
  guideOverlay: document.querySelector("#guide-overlay"),
  guideCloseBtn: document.querySelector("#guide-close-btn"),
  nameInput: document.querySelector("#name-input"),
  roomInput: document.querySelector("#room-input"),
  playRandomBtn: document.querySelector("#play-random-btn"),
  createRoomBtn: document.querySelector("#create-room-btn"),
  joinRoomBtn: document.querySelector("#join-room-btn"),
  watchRoomBtn: document.querySelector("#watch-room-btn"),
  setupStatus: document.querySelector("#setup-status"),
};

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_error) {
    // Ignore unavailable storage.
  }
}

function sanitizeRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 6);
}

function getPlayerName() {
  const fallbackName = ``;
  const rawValue = ui.nameInput.value.trim() || readStorage(PLAYER_NAME_STORAGE_KEY) || fallbackName;
  writeStorage(PLAYER_NAME_STORAGE_KEY, rawValue);
  return rawValue;
}

function roomTokenStorageKey(roomCode) {
  return `${ROOM_TOKEN_STORAGE_PREFIX}${sanitizeRoomCode(roomCode)}`;
}

function getStoredRoomToken(roomCode) {
  const cleanRoomCode = sanitizeRoomCode(roomCode);
  if (!cleanRoomCode) {
    return "";
  }
  return readStorage(roomTokenStorageKey(cleanRoomCode)) || "";
}

function rememberRoomToken(roomCode, playerToken) {
  const cleanRoomCode = sanitizeRoomCode(roomCode);
  if (cleanRoomCode && playerToken) {
    writeStorage(roomTokenStorageKey(cleanRoomCode), playerToken);
  }
}

function roomCodeFromUrl() {
  const url = new URL(window.location.href);
  return sanitizeRoomCode(url.searchParams.get("room") || "");
}

function buildRoomUrl(roomCode) {
  const cleanRoomCode = sanitizeRoomCode(roomCode);
  return cleanRoomCode ? `/room?room=${encodeURIComponent(cleanRoomCode)}` : "/room";
}

function renderConnection() {
  ui.connectionPill.textContent =
    state.socketStatus === "online"
      ? "Connected"
      : state.socketStatus === "offline"
        ? "Offline"
        : "Connecting";
  ui.connectionPill.className = `status-pill ${state.socketStatus}`;
}

function render() {
  renderConnection();
  ui.setupStatus.textContent = state.notice;
  ui.setupStatus.hidden = !state.notice;
}

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

function connectSocket() {
  if (
    state.socket &&
    (state.socket.readyState === WebSocket.OPEN ||
      state.socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  state.socketStatus = "connecting";
  render();

  const socket = new WebSocket(socketUrl());
  state.socket = socket;

  socket.addEventListener("open", () => {
    state.socketStatus = "online";
    flushQueue();
    render();
  });

  socket.addEventListener("message", (event) => {
    handleMessage(event.data);
  });

  socket.addEventListener("close", () => {
    state.socketStatus = "offline";
    state.socket = null;
    state.notice = "Connection closed. Refresh the page and try again.";
    render();
  });

  socket.addEventListener("error", () => {
    state.notice = "A network error occurred while talking to the game server.";
    render();
  });
}

function flushQueue() {
  while (
    state.queue.length > 0 &&
    state.socket &&
    state.socket.readyState === WebSocket.OPEN
  ) {
    state.socket.send(JSON.stringify(state.queue.shift()));
  }
}

function send(payload) {
  connectSocket();

  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    state.queue.push(payload);
    return;
  }

  state.socket.send(JSON.stringify(payload));
}

function handleMessage(raw) {
  let message;

  try {
    message = JSON.parse(raw);
  } catch (_error) {
    return;
  }

  if (message.type === "state") {
    state.room = message.state;
    if (state.room?.roomCode) {
      rememberRoomToken(state.room.roomCode, state.room.playerToken);
      window.location.assign(buildRoomUrl(state.room.roomCode));
    }
    return;
  }

  if (message.type === "info") {
    state.notice = message.message || state.notice;
    render();
    return;
  }

  if (message.type === "error") {
    state.notice = message.message || "The game server rejected that request.";
    render();
  }
}

function createRoom() {
  state.notice = "Creating room...";
  render();
  send({
    type: "create_room",
    name: getPlayerName(),
  });
}

function joinRandomRoom() {
  state.notice = "Finding an open room...";
  render();
  send({
    type: "join_random_room",
    name: getPlayerName(),
  });
}

function joinRoom() {
  const roomCode = sanitizeRoomCode(ui.roomInput.value);
  if (!roomCode) {
    state.notice = "Enter a room code first.";
    render();
    return;
  }

  state.notice = `Joining room ${roomCode}...`;
  render();
  send({
    type: "join_room",
    name: getPlayerName(),
    roomCode,
    playerToken: getStoredRoomToken(roomCode),
  });
}

function spectateRoom() {
  const roomCode = sanitizeRoomCode(ui.roomInput.value);
  if (!roomCode) {
    state.notice = "Enter a room code first.";
    render();
    return;
  }

  state.notice = `Watching room ${roomCode}...`;
  render();
  send({
    type: "spectate_room",
    name: getPlayerName(),
    roomCode,
    playerToken: getStoredRoomToken(roomCode),
  });
}

function hydrateDefaultValues() {
  const storedName = readStorage(PLAYER_NAME_STORAGE_KEY);
  ui.nameInput.value = storedName || ``;

  const roomCode = roomCodeFromUrl();
  if (roomCode) {
    ui.roomInput.value = roomCode;
  }
}

function openGuide() {
  if (!ui.guideOverlay) {
    return;
  }
  ui.guideOverlay.hidden = false;
}

function closeGuide() {
  if (!ui.guideOverlay) {
    return;
  }
  ui.guideOverlay.hidden = true;
}

if (ui.playRandomBtn) {
  ui.playRandomBtn.addEventListener("click", joinRandomRoom);
}
ui.createRoomBtn.addEventListener("click", createRoom);
ui.joinRoomBtn.addEventListener("click", joinRoom);
if (ui.watchRoomBtn) {
  ui.watchRoomBtn.addEventListener("click", spectateRoom);
}
if (ui.guideBtn) {
  ui.guideBtn.addEventListener("click", openGuide);
}
if (ui.guideCloseBtn) {
  ui.guideCloseBtn.addEventListener("click", closeGuide);
}
if (ui.guideOverlay) {
  ui.guideOverlay.addEventListener("click", (event) => {
    if (event.target === ui.guideOverlay) {
      closeGuide();
    }
  });
}
ui.nameInput.addEventListener("change", () => {
  writeStorage(PLAYER_NAME_STORAGE_KEY, ui.nameInput.value.trim());
});
ui.nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRandomRoom();
  }
});
ui.roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});

hydrateDefaultValues();
connectSocket();
render();
