const state = {
  socket: null,
  socketStatus: "connecting",
  queue: [],
  room: null,
  notice: "Create a room or join one to start a multiplayer match.",
  noticeTone: "info",
  selectedCounts: {},
  pendingLocalAction: null,
  logExpanded: false,
  crashOverlay: null,
  moment: null,
  momentQueue: [],
  peerReview: null,
  discardBrowserOpen: false,
};

const LOG_COLLAPSE_COUNT = 4;
const CRASH_OVERLAY_DURATION_MS = 2600;
const MOMENT_DURATION_MS = 2200;
const PLAYER_NAME_STORAGE_KEY = "exploding-productions-player-name";
const ROOM_TOKEN_STORAGE_PREFIX = "exploding-productions-room-token:";
let crashOverlayTimer = null;
let momentTimer = null;
let attemptedRoomRestore = false;

const CARD_VISUALS = {
  hotPotato: { symbol: "!!", label: "Production Crash" },
  ovenMitt: { symbol: "BI", label: "Blame The Intern" },
  nope: { symbol: "NO", label: "Nope" },
  peek: { symbol: "PR", label: "Peer Review" },
  skip: { symbol: "SK", label: "Skip" },
  attack: { symbol: "NA", label: "Nerd Attack" },
  mixUp: { symbol: "SH", label: "Shuffle" },
  swipe: { symbol: "PM", label: "Project Manager" },
  cookie: { symbol: "RD", label: "Rubber Duck" },
  donut: { symbol: "CB", label: "Coffee Break" },
  pretzel: { symbol: "SN", label: "Sticky Note" },
  candy: { symbol: "PT", label: "Posh Training" },
};

const CARD_ART = {
  hotPotato: "assets/cards/production-crash.webp",
  ovenMitt: "assets/cards/blame-the-intern.webp",
  nope: "assets/cards/nope.webp",
  peek: "assets/cards/peer-review.webp",
  skip: "assets/cards/skip.webp",
  attack: "assets/cards/nerd-attack.webp",
  mixUp: "assets/cards/shuffle.webp",
  swipe: "assets/cards/project-manager.webp",
  cookie: "assets/cards/rubber-duck.webp",
  donut: "assets/cards/coffee-break.webp",
  pretzel: "assets/cards/sticky-note.webp",
  candy: "assets/cards/posh-training.webp",
};

const CARD_ART_TREATMENTS = {
  cookie: {
    positionX: "41%",
    scale: 1,
  },
};

const CARD_LABEL_TO_KEY = Object.fromEntries(
  Object.entries(CARD_VISUALS).map(([key, value]) => [value.label, key]),
);

const ACTION_MOMENT_COPY = {
  nope: "A risky move just got shut down.",
  peek: "The next three cards are being inspected.",
  skip: "The draw step was intentionally skipped.",
  attack: "A Nerd Attack just dumped extra draw pressure on the next player.",
  mixUp: "The deck order is getting scrambled.",
  swipe: "A random card is being yanked from another hand.",
};

const ui = {
  connectionPill: document.querySelector("#connection-pill"),
  setupGrid: document.querySelector("#setup-grid"),
  nameInput: document.querySelector("#name-input"),
  roomInput: document.querySelector("#room-input"),
  setupStatus: document.querySelector("#setup-status"),
  roomAccessPanel: document.querySelector("#room-access-panel"),
  setupCompactNote: document.querySelector("#setup-compact-note"),
  createRoomBtn: document.querySelector("#create-room-btn"),
  joinRoomBtn: document.querySelector("#join-room-btn"),
  leaveRoomBtn: document.querySelector("#leave-room-btn"),
  startGameBtn: document.querySelector("#start-game-btn"),
  copyRoomBtn: document.querySelector("#copy-room-btn"),
  drawBtnTop: document.querySelector("#draw-btn-top"),
  drawBtnBottom: document.querySelector("#draw-btn-bottom"),
  drawStatus: document.querySelector("#draw-status"),
  roomTitle: document.querySelector("#room-title"),
  roomCodeDisplay: document.querySelector("#room-code-display"),
  phaseDisplay: document.querySelector("#phase-display"),
  noticeBanner: document.querySelector("#notice-banner"),
  setupCard: document.querySelector("#setup-card"),
  roomCard: document.querySelector("#room-card"),
  logToggleBtn: document.querySelector("#log-toggle-btn"),
  playersList: document.querySelector("#players-list"),
  turnTitle: document.querySelector("#turn-title"),
  deckCount: document.querySelector("#deck-count"),
  discardName: document.querySelector("#discard-name"),
  discardPileBtn: document.querySelector("#discard-pile-btn"),
  discardPile: document.querySelector("#discard-pile"),
  discardHint: document.querySelector("#discard-hint"),
  promptBody: document.querySelector("#prompt-body"),
  logFeed: document.querySelector("#log-feed"),
  comboBar: document.querySelector("#combo-bar"),
  handGrid: document.querySelector("#hand-grid"),
  handSummary: document.querySelector("#hand-summary"),
  crashOverlay: document.querySelector("#crash-overlay"),
  crashOverlayTitle: document.querySelector("#crash-overlay-title"),
  crashOverlayText: document.querySelector("#crash-overlay-text"),
  momentOverlay: document.querySelector("#moment-overlay"),
  momentKicker: document.querySelector("#moment-kicker"),
  momentTitle: document.querySelector("#moment-title"),
  momentText: document.querySelector("#moment-text"),
  momentArt: document.querySelector("#moment-art"),
  reviewOverlay: document.querySelector("#review-overlay"),
  reviewMessage: document.querySelector("#review-message"),
  reviewCardGrid: document.querySelector("#review-card-grid"),
  reviewCloseBtn: document.querySelector("#review-close-btn"),
  discardBrowserOverlay: document.querySelector("#discard-browser-overlay"),
  discardBrowserMessage: document.querySelector("#discard-browser-message"),
  discardBrowserGrid: document.querySelector("#discard-browser-grid"),
  discardBrowserCloseBtn: document.querySelector("#discard-browser-close-btn"),
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

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
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

function getStoredPlayerName() {
  return readStorage(PLAYER_NAME_STORAGE_KEY);
}

function rememberPlayerName(name) {
  const cleanName = String(name || "").trim();
  if (cleanName) {
    writeStorage(PLAYER_NAME_STORAGE_KEY, cleanName);
  }
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

function forgetRoomToken(roomCode) {
  const cleanRoomCode = sanitizeRoomCode(roomCode);
  if (cleanRoomCode) {
    removeStorage(roomTokenStorageKey(cleanRoomCode));
  }
}

function roomCodeFromUrl() {
  const url = new URL(window.location.href);
  return sanitizeRoomCode(url.searchParams.get("room") || "");
}

function updateRoomUrl(roomCode) {
  const url = new URL(window.location.href);
  const cleanRoomCode = sanitizeRoomCode(roomCode);
  if (cleanRoomCode) {
    url.searchParams.set("room", cleanRoomCode);
  } else {
    url.searchParams.delete("room");
  }
  window.history.replaceState({}, "", url);
}

const defaultName = getStoredPlayerName() || `Player-${Math.floor(Math.random() * 900 + 100)}`;
ui.nameInput.value = defaultName;

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
    state.room = null;
    resetLocalInteraction();
    hideCrashOverlay();
    state.momentQueue = [];
    hideMoment();
    hidePeerReview();
    closeDiscardBrowser();
    state.notice = "Connection closed. Refresh the page or reconnect by joining a room again.";
    render();
  });

  socket.addEventListener("error", () => {
    state.notice = "A network error occurred while talking to the game server.";
    state.noticeTone = "error";
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
    const previousRoom = state.room;
    const previousRoomCode = previousRoom?.roomCode || null;
    state.room = message.state;
    if (state.room?.roomCode) {
      ui.roomInput.value = state.room.roomCode;
      updateRoomUrl(state.room.roomCode);
      rememberActiveIdentity(state.room.roomCode, state.room.playerToken);
    }
    reconcileLocalState();
    handleRoomTransition(previousRoom, state.room);
    render();
    if (!previousRoomCode && state.room?.roomCode) {
      revealActiveRoom();
    }
    return;
  }

  if (message.type === "peer_review_result") {
    state.notice = message.message || "Peer Review is ready.";
    state.noticeTone = "info";
    showPeerReview({
      message: message.message || "Peer Review is ready.",
      cards: message.cards || [],
    });
    render();
    return;
  }

  if (message.type === "info") {
    state.notice = message.message;
    state.noticeTone = "info";
    render();
    return;
  }

  if (message.type === "error") {
    state.notice = message.message;
    state.noticeTone = "error";
    render();
    return;
  }

  if (message.type === "left_room") {
    const previousRoomCode = state.room?.roomCode || roomCodeFromUrl();
    if (previousRoomCode) {
      forgetRoomToken(previousRoomCode);
    }
    updateRoomUrl("");
    state.room = null;
    resetLocalInteraction();
    state.logExpanded = false;
    hideCrashOverlay();
    state.momentQueue = [];
    hideMoment();
    hidePeerReview();
    closeDiscardBrowser();
    state.notice = "You left the room.";
    state.noticeTone = "info";
    render();
  }
}

function handleRoomTransition(previousRoom, nextRoom) {
  if (!nextRoom) {
    state.logExpanded = false;
    hideCrashOverlay();
    state.momentQueue = [];
    hideMoment();
    hidePeerReview();
    closeDiscardBrowser();
    return;
  }

  const sameRoom = previousRoom?.roomCode && previousRoom.roomCode === nextRoom.roomCode;
  if (!sameRoom) {
    state.logExpanded = false;
    state.momentQueue = [];
    hideMoment();
    hidePeerReview();
    closeDiscardBrowser();
    return;
  }

  const newEntries = getNewLogEntries(previousRoom?.log || [], nextRoom.log || []);
  const crashEntry = newEntries.find(isCrashMomentLog);
  if (crashEntry) {
    showCrashOverlay(buildCrashOverlayPayload(crashEntry));
  }

  const actionMoment = [...newEntries].map(buildActionMoment).find(Boolean);
  const drawMoment = buildDrawMoment(previousRoom, nextRoom);

  queueMoment(actionMoment);
  queueMoment(drawMoment);
}

function getNewLogEntries(previousLog, nextLog) {
  const maxOverlap = Math.min(previousLog.length, nextLog.length);

  for (let overlap = maxOverlap; overlap >= 0; overlap -= 1) {
    const previousSuffix = previousLog.slice(previousLog.length - overlap);
    const nextPrefix = nextLog.slice(0, overlap);

    if (previousSuffix.length !== nextPrefix.length) {
      continue;
    }

    if (previousSuffix.every((entry, index) => entry === nextPrefix[index])) {
      return nextLog.slice(overlap);
    }
  }

  return nextLog.slice();
}

function isCrashMomentLog(entry) {
  return (
    entry.includes("neutralized a Production Crash") ||
    entry.includes("was knocked out by a Production Crash")
  );
}

function buildCrashOverlayPayload(entry) {
  const actor = entry
    .replace(" neutralized a Production Crash by blaming the intern.", "")
    .replace(" was knocked out by a Production Crash.", "");

  if (entry.includes("neutralized a Production Crash")) {
    return {
      title: "Production Crash Contained",
      text: `${actor} blamed the intern and kept prod alive.`,
    };
  }

  return {
    title: "Production Crash",
    text: `${actor} deployed straight into the apology draft.`,
  };
}

function buildCountMap(hand) {
  const counts = new Map();
  (hand || []).forEach((card) => {
    counts.set(card.key, card.count);
  });
  return counts;
}

function getAddedHandCards(previousHand, nextHand) {
  const previousCounts = buildCountMap(previousHand);
  const additions = [];

  (nextHand || []).forEach((card) => {
    const previousCount = previousCounts.get(card.key) || 0;
    const delta = card.count - previousCount;
    for (let index = 0; index < delta; index += 1) {
      additions.push(card.key);
    }
  });

  return additions;
}

function buildDrawMoment(previousRoom, nextRoom) {
  if (!previousRoom?.started || !nextRoom?.started) {
    return null;
  }

  const addedCards = getAddedHandCards(previousRoom.hand, nextRoom.hand);
  if (addedCards.length !== 1) {
    return null;
  }

  const cardKey = addedCards[0];
  return {
    kicker: "Card Added",
    title: CARD_VISUALS[cardKey]?.label || "New Card",
    text: "This card was added to your hand.",
    cardKey,
  };
}

function buildActionMoment(entry) {
  const playedMatch = entry.match(/^(.*?) played (.+)\.$/);
  if (!playedMatch) {
    return null;
  }

  const actorName = playedMatch[1];
  const label = playedMatch[2];
  const cardKey = CARD_LABEL_TO_KEY[label];

  if (!cardKey || !ACTION_MOMENT_COPY[cardKey]) {
    return null;
  }

  return {
    kicker: actorName,
    title: label,
    text: ACTION_MOMENT_COPY[cardKey],
    cardKey,
  };
}

function presentMoment(payload) {
  if (!payload) {
    return;
  }

  if (momentTimer) {
    window.clearTimeout(momentTimer);
    momentTimer = null;
  }

  state.moment = payload;
  momentTimer = window.setTimeout(() => {
    hideMoment();
    renderMoment();
  }, MOMENT_DURATION_MS);
  renderMoment();
}

function queueMoment(payload) {
  if (!payload) {
    return;
  }

  if (state.moment) {
    state.momentQueue.push(payload);
    return;
  }

  presentMoment(payload);
}

function hideMoment() {
  if (momentTimer) {
    window.clearTimeout(momentTimer);
    momentTimer = null;
  }

  state.moment = null;

  if (state.momentQueue.length > 0) {
    const nextMoment = state.momentQueue.shift();
    presentMoment(nextMoment);
    return;
  }

  renderMoment();
}

function showPeerReview(payload) {
  state.peerReview = payload;
  renderPeerReview();
}

function hidePeerReview() {
  state.peerReview = null;
  renderPeerReview();
}

function getKnownCardPayload(cardKey) {
  if (!state.room) {
    return null;
  }

  const sources = [
    ...(state.room.hand || []),
    ...(state.room.requestOptions || []),
    ...(state.room.discardPile || []),
    ...(state.room.discardChoices || []),
  ];

  return sources.find((card) => card.key === cardKey) || null;
}

function getDiscardBrowserCards() {
  const basePile = Array.isArray(state.room?.discardPile) ? [...state.room.discardPile] : [];

  if (state.pendingLocalAction?.kind !== "five") {
    return basePile;
  }

  const pendingCards = state.pendingLocalAction.cardKeys.map((cardKey, index) => {
    const knownCard = getKnownCardPayload(cardKey);
    return {
      ...(knownCard || {
        key: cardKey,
        name: CARD_VISUALS[cardKey]?.label || "Card",
        tag: "Desk Loot",
        themeClass: "",
      }),
      reclaimable: true,
      discardIndex: -(index + 1),
      provisional: true,
    };
  });

  return [...pendingCards, ...basePile];
}

function canBrowseDiscardPile() {
  return (
    !!state.room &&
    state.pendingLocalAction?.kind === "five" &&
    getDiscardBrowserCards().some((card) => card.reclaimable)
  );
}

function openDiscardBrowser() {
  if (!canBrowseDiscardPile()) {
    return;
  }
  state.discardBrowserOpen = true;
  renderDiscardBrowser();
  renderCenter();
}

function closeDiscardBrowser() {
  state.discardBrowserOpen = false;
  renderDiscardBrowser();
  renderCenter();
}

function showCrashOverlay(payload) {
  hideCrashOverlay();
  state.crashOverlay = payload;
  crashOverlayTimer = window.setTimeout(() => {
    hideCrashOverlay();
    renderCrashOverlay();
  }, CRASH_OVERLAY_DURATION_MS);
}

function hideCrashOverlay() {
  if (crashOverlayTimer) {
    window.clearTimeout(crashOverlayTimer);
    crashOverlayTimer = null;
  }
  state.crashOverlay = null;
}

function reconcileLocalState() {
  if (!state.room) {
    resetLocalInteraction();
    return;
  }

  const available = new Map(state.room.hand.map((card) => [card.key, card.count]));

  Object.keys(state.selectedCounts).forEach((key) => {
    const count = available.get(key);
    if (!count) {
      delete state.selectedCounts[key];
      return;
    }
    if (state.selectedCounts[key] > count) {
      state.selectedCounts[key] = count;
    }
    if (state.selectedCounts[key] <= 0) {
      delete state.selectedCounts[key];
    }
  });

  if (state.room.pendingChoice || !state.room.canPlay) {
    state.pendingLocalAction = null;
    state.discardBrowserOpen = false;
  }
}

function resetLocalInteraction() {
  state.selectedCounts = {};
  state.pendingLocalAction = null;
  state.discardBrowserOpen = false;
}

function clearSelections() {
  resetLocalInteraction();
  render();
}

function toggleLogExpansion() {
  if (!state.room || state.room.log.length <= LOG_COLLAPSE_COUNT) {
    return;
  }

  state.logExpanded = !state.logExpanded;
  renderLog();
}

function getPlayerName() {
  const value = ui.nameInput.value.trim();
  return value || defaultName;
}

function rememberActiveIdentity(roomCode, playerToken) {
  const playerName = getPlayerName();
  rememberPlayerName(playerName);
  if (roomCode && playerToken) {
    rememberRoomToken(roomCode, playerToken);
  }
}

function restoreRoomFromUrl() {
  if (attemptedRoomRestore) {
    return;
  }
  attemptedRoomRestore = true;

  const roomCode = roomCodeFromUrl();
  if (!roomCode) {
    return;
  }

  ui.roomInput.value = roomCode;
  const playerToken = getStoredRoomToken(roomCode);

  if (!playerToken) {
    state.notice = `Room ${roomCode} is loaded from the link. Enter your name and join when you're ready.`;
    state.noticeTone = "info";
    return;
  }

  state.notice = `Reconnecting to room ${roomCode}...`;
  state.noticeTone = "info";
  send({
    type: "join_room",
    name: getPlayerName(),
    roomCode,
    playerToken,
  });
}

function createRoom() {
  resetLocalInteraction();
  rememberPlayerName(getPlayerName());
  send({
    type: "create_room",
    name: getPlayerName(),
  });
}

function joinRoom() {
  resetLocalInteraction();
  const roomCode = sanitizeRoomCode(ui.roomInput.value);
  rememberPlayerName(getPlayerName());
  send({
    type: "join_room",
    name: getPlayerName(),
    roomCode,
    playerToken: getStoredRoomToken(roomCode),
  });
}

function leaveRoom() {
  if (!state.room) {
    return;
  }
  send({ type: "leave_room" });
}

function startGame() {
  resetLocalInteraction();
  send({ type: "start_game" });
}

function drawCard() {
  resetLocalInteraction();
  send({ type: "draw_card" });
}

function respondNope(playNope) {
  send({ type: "respond_nope", playNope });
}

function choosePlacement(placement) {
  send({
    type: "choose_reinsert",
    placement,
  });
}

function copyRoomCode() {
  if (!state.room?.roomCode) {
    return;
  }

  if (!navigator.clipboard?.writeText) {
    state.notice = "Clipboard access is not available in this browser.";
    state.noticeTone = "error";
    render();
    return;
  }

  navigator.clipboard
    .writeText(state.room.roomCode)
    .then(() => {
      state.notice = `Copied room code ${state.room.roomCode}.`;
      state.noticeTone = "info";
      render();
    })
    .catch(() => {
      state.notice = "Could not copy the room code from this browser.";
      state.noticeTone = "error";
      render();
    });
}

function selectionStats() {
  const entries = Object.entries(state.selectedCounts).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const distinct = entries.length;
  const sameKey = entries.length === 1 ? entries[0][0] : null;
  const sameCount = entries.length === 1 ? entries[0][1] : 0;
  const uniqueKeys = entries
    .filter(([, count]) => count === 1)
    .map(([key]) => key);

  return {
    entries,
    total,
    distinct,
    sameKey,
    sameCount,
    uniqueKeys,
    pairReady: total === 2 && sameKey !== null && sameCount === 2,
    trioReady: total === 3 && sameKey !== null && sameCount === 3,
    fiveReady: total === 5 && distinct === 5 && uniqueKeys.length === 5,
  };
}

function toggleSnackSelection(card) {
  if (!state.room?.canPlay || state.room.pendingChoice || state.pendingLocalAction) {
    return;
  }

  const current = state.selectedCounts[card.key] || 0;
  const next = current + 1 > card.count ? 0 : current + 1;

  if (next === 0) {
    delete state.selectedCounts[card.key];
  } else {
    state.selectedCounts[card.key] = next;
  }

  render();
}

function playCard(card) {
  if (!state.room || state.room.pendingChoice || state.pendingLocalAction) {
    return;
  }

  if (card.isSnack) {
    toggleSnackSelection(card);
    return;
  }

  if (!card.turnPlayable) {
    return;
  }

  if (card.needsTarget) {
    state.pendingLocalAction = {
      kind: "target-card",
      cardKey: card.key,
      label: card.name,
    };
    render();
    return;
  }

  send({
    type: "play_card",
    cardKey: card.key,
  });
}

function beginPair() {
  const stats = selectionStats();
  if (!stats.pairReady) {
    return;
  }
  state.pendingLocalAction = {
    kind: "pair",
    cardKey: stats.sameKey,
    label: "2 of a Kind",
  };
  render();
}

function beginTrio() {
  const stats = selectionStats();
  if (!stats.trioReady) {
    return;
  }
  state.pendingLocalAction = {
    kind: "trio",
    cardKey: stats.sameKey,
    label: "3 of a Kind",
    targetId: null,
  };
  render();
}

function beginFive() {
  const stats = selectionStats();
  if (!stats.fiveReady) {
    return;
  }
  state.pendingLocalAction = {
    kind: "five",
    cardKeys: stats.uniqueKeys,
    label: "5 Different Tools",
  };
  render();
}

function cancelPendingLocalAction() {
  state.pendingLocalAction = null;
  render();
}

function chooseTarget(targetId) {
  if (!state.pendingLocalAction) {
    return;
  }

  const action = state.pendingLocalAction;

  if (action.kind === "target-card") {
    send({
      type: "play_card",
      cardKey: action.cardKey,
      targetId,
    });
    resetLocalInteraction();
    return;
  }

  if (action.kind === "pair") {
    send({
      type: "play_combo",
      comboType: "pair",
      cardKey: action.cardKey,
      targetId,
    });
    resetLocalInteraction();
    return;
  }

  if (action.kind === "trio") {
    state.pendingLocalAction = {
      ...action,
      targetId,
    };
    render();
  }
}

function chooseRequestedCard(requestedKey) {
  if (!state.pendingLocalAction || state.pendingLocalAction.kind !== "trio") {
    return;
  }

  send({
    type: "play_combo",
    comboType: "trio",
    cardKey: state.pendingLocalAction.cardKey,
    targetId: state.pendingLocalAction.targetId,
    requestedKey,
  });
  resetLocalInteraction();
}

function chooseDiscardCard(discardKey) {
  if (!state.pendingLocalAction || state.pendingLocalAction.kind !== "five") {
    return;
  }

  send({
    type: "play_combo",
    comboType: "five",
    cardKeys: state.pendingLocalAction.cardKeys,
    discardKey,
  });
  resetLocalInteraction();
}

function getCardVisual(cardKey) {
  return CARD_VISUALS[cardKey] || { symbol: "[]", label: "Card" };
}

function getCardArt(cardKey) {
  return CARD_ART[cardKey] || null;
}

function getCardArtTreatment(cardKey) {
  return CARD_ART_TREATMENTS[cardKey] || { positionX: "50%", scale: 1 };
}

function getCardBackgroundStyle(cardKey) {
  const artwork = getCardArt(cardKey);
  if (!artwork) {
    return "";
  }

  const treatment = getCardArtTreatment(cardKey);
  return [
    `background-image: url('${artwork}')`,
    `background-position: ${treatment.positionX} top`,
    `background-size: ${Math.round(treatment.scale * 100)}% auto`,
  ].join("; ");
}

function getCardImageStyle(cardKey) {
  const treatment = getCardArtTreatment(cardKey);
  return [
    `object-position: ${treatment.positionX} top`,
    `transform: scale(${treatment.scale})`,
    "transform-origin: center top",
  ].join("; ");
}

function isLiveMatch() {
  return Boolean(state.room?.started && !state.room?.winnerId);
}

function render() {
  renderConnection();
  renderSetupPanel();
  renderRoomMeta();
  renderDrawControls();
  renderPlayers();
  renderCenter();
  renderLog();
  renderComboBar();
  renderHand();
  renderCrashOverlay();
  renderMoment();
  renderPeerReview();
  renderDiscardBrowser();
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

function renderSetupPanel() {
  const liveMatch = isLiveMatch();
  ui.setupGrid.classList.toggle("match-live", liveMatch);
  ui.setupCard.classList.toggle("compact", liveMatch);
  ui.roomAccessPanel.hidden = liveMatch;
  ui.setupCompactNote.hidden = !liveMatch;

  if (liveMatch) {
    ui.setupCompactNote.textContent =
      "Use the room panel for the active code and room controls.";
  }
}

function renderRoomMeta() {
  if (!state.room) {
    ui.roomTitle.textContent = "No Room Yet";
    ui.roomCodeDisplay.textContent = "----";
    ui.phaseDisplay.textContent = "Lobby";
    ui.noticeBanner.textContent = state.notice;
    ui.setupStatus.textContent = "No active room yet. Create or join a room to continue.";
    ui.startGameBtn.disabled = true;
    ui.copyRoomBtn.disabled = true;
    ui.leaveRoomBtn.disabled = true;
    return;
  }

  ui.roomTitle.textContent = `Room ${state.room.roomCode}`;
  ui.roomCodeDisplay.textContent = state.room.roomCode;
  ui.phaseDisplay.textContent = state.room.phaseLabel;
  ui.noticeBanner.textContent = state.notice;
  ui.setupStatus.textContent = `Active room code: ${state.room.roomCode}`;
  ui.startGameBtn.disabled = !state.room.canStart;
  ui.copyRoomBtn.disabled = false;
  ui.leaveRoomBtn.disabled = false;
}

function revealActiveRoom() {
  if (ui.roomCard) {
    ui.roomCard.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}

function getSelfPlayer() {
  return state.room?.players.find((player) => player.isYou) || null;
}

function getDrawUiState() {
  if (!state.room) {
    return {
      disabled: true,
      label: "Draw To End Turn",
      status: "Join a room to start drawing from the deck.",
    };
  }

  const selfPlayer = getSelfPlayer();
  const isYourTurn = Boolean(selfPlayer?.isCurrentTurn);
  const drawsLeft = selfPlayer?.requiredDraws ?? 0;

  if (!isYourTurn) {
    return {
      disabled: true,
      label: "Waiting For Turn",
      status: "This control becomes available during your turn.",
    };
  }

  if (drawsLeft > 1) {
    return {
      disabled: !state.room.canDraw,
      label: `Draw Card (${drawsLeft} left)`,
      status: `Extra draw pressure is active. You still need to resolve ${drawsLeft} draws this turn.`,
    };
  }

  return {
    disabled: !state.room.canDraw,
    label: "Draw To End Turn",
  };
}

function renderDrawControls() {
  const drawState = getDrawUiState();

  ui.drawBtnTop.disabled = drawState.disabled;
  ui.drawBtnBottom.disabled = drawState.disabled;
  ui.drawBtnTop.textContent = drawState.label;
  ui.drawBtnBottom.textContent = drawState.label;
  if (ui.drawStatus) {
    ui.drawStatus.textContent = drawState.status;
  }
}

function renderPlayers() {
  ui.playersList.innerHTML = "";

  if (!state.room) {
    ui.playersList.innerHTML =
      '<div class="empty-state">Players will appear here once a room is active.</div>';
    return;
  }

  state.room.players.forEach((player) => {
    const article = document.createElement("article");
    article.className = "player-card";

    if (player.isCurrentTurn) {
      article.classList.add("active-turn");
    }

    if (!player.alive) {
      article.classList.add("eliminated");
    }

    const badges = [];
    if (player.isHost) {
      badges.push('<span class="badge host">Host</span>');
    }
    if (player.isCurrentTurn) {
      badges.push('<span class="badge turn">Turn</span>');
    }
    if (!player.alive) {
      badges.push('<span class="badge dead">Out</span>');
    }
    if (player.isYou) {
      badges.push('<span class="badge">You</span>');
    }

    article.innerHTML = `
      <div class="player-row">
        <div>
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-meta">Hand ${player.handCount} • Defuses ${player.stabilizers} • Draws ${player.requiredDraws}</div>
        </div>
        <div class="player-badges">${badges.join("")}</div>
      </div>
    `;

    ui.playersList.append(article);
  });
}

function renderCenter() {
  if (!state.room) {
    ui.turnTitle.textContent = "Waiting For Players";
    ui.deckCount.textContent = "0 cards";
    ui.discardName.textContent = "0 cards";
    if (ui.discardPile) {
      ui.discardPile.innerHTML = '<div class="discard-empty">Discard pile is empty.</div>';
    }
    if (ui.discardHint) {
      ui.discardHint.textContent = "Played cards stack here.";
    }
    if (ui.discardPileBtn) {
      ui.discardPileBtn.disabled = true;
      ui.discardPileBtn.classList.remove("active");
      ui.discardPileBtn.setAttribute("aria-expanded", "false");
    }
    ui.promptBody.textContent = "Start a room to begin.";
    return;
  }

  ui.turnTitle.textContent = state.room.turnLabel;
  ui.deckCount.textContent = `${state.room.deckCount} cards`;

  const pendingChoice = state.room.pendingChoice;
  const localAction = state.pendingLocalAction;
  const discardPile =
    localAction?.kind === "five"
      ? getDiscardBrowserCards()
      : Array.isArray(state.room.discardPile)
        ? state.room.discardPile
        : [];
  const discardCount =
    localAction?.kind === "five"
      ? discardPile.length
      : state.room.discardCount || discardPile.length;
  ui.discardName.textContent = `${discardCount} card${discardCount === 1 ? "" : "s"}`;

  if (ui.discardPile) {
    const preview = discardPile.slice(0, 4).reverse();
    if (preview.length === 0) {
      ui.discardPile.innerHTML = '<div class="discard-empty">Discard pile is empty.</div>';
      ui.discardPile.classList.add("empty");
    } else {
      ui.discardPile.classList.remove("empty");
      ui.discardPile.innerHTML = preview
        .map((card, index) => {
          const offsetClass = `offset-${index}`;
          if (getCardArt(card.key)) {
            return `<div class="discard-preview-card ${offsetClass}" style="${getCardBackgroundStyle(card.key)}" aria-hidden="true"></div>`;
          }
          return `<div class="discard-preview-card discard-preview-fallback ${offsetClass}" aria-hidden="true">${escapeHtml(getCardVisual(card.key).symbol)}</div>`;
        })
        .join("");
    }
  }

  const discardPileInteractive = canBrowseDiscardPile();
  if (ui.discardPileBtn) {
    ui.discardPileBtn.disabled = !discardPileInteractive;
    ui.discardPileBtn.classList.toggle("active", discardPileInteractive);
    ui.discardPileBtn.setAttribute("aria-expanded", String(state.discardBrowserOpen && discardPileInteractive));
  }

  if (ui.discardHint) {
    if (discardPileInteractive) {
      ui.discardHint.textContent = "Click the discard pile to reclaim 1 card.";
    } else if (discardCount === 0) {
      ui.discardHint.textContent = "Played cards stack here.";
    } else {
      ui.discardHint.textContent = "Recent plays stack here.";
    }
  }

  if (pendingChoice?.kind === "reinsert") {
    ui.promptBody.innerHTML = `
      <div>Choose where to hide the Production Crash back in the deck.</div>
      <div class="choice-grid">
        ${pendingChoice.options
          .map(
            (option) =>
              `<button class="choice-btn" data-placement="${option.value}">${escapeHtml(option.label)}</button>`,
          )
          .join("")}
      </div>
    `;

    ui.promptBody.querySelectorAll("[data-placement]").forEach((button) => {
      button.addEventListener("click", () => choosePlacement(button.dataset.placement));
    });
    return;
  }

  if (pendingChoice?.kind === "reaction") {
    ui.promptBody.innerHTML = `
      <div><strong>${escapeHtml(pendingChoice.actorName)}</strong> played <strong>${escapeHtml(pendingChoice.effectLabel)}</strong>.</div>
      <div class="action-row wrap">
        <button id="play-nope-btn" class="primary-btn">Play Nope</button>
        <button id="pass-nope-btn" class="secondary-btn">Let It Happen</button>
      </div>
    `;
    ui.promptBody.querySelector("#play-nope-btn").addEventListener("click", () => respondNope(true));
    ui.promptBody.querySelector("#pass-nope-btn").addEventListener("click", () => respondNope(false));
    return;
  }

  if (localAction?.kind === "target-card" || localAction?.kind === "pair") {
    ui.promptBody.innerHTML = `
      <div>Choose a player for <strong>${escapeHtml(localAction.label)}</strong>.</div>
      <div class="target-list">
        ${state.room.availableTargets
          .map(
            (target) =>
              `<button class="target-btn" data-target="${target.id}">${escapeHtml(target.name)}</button>`,
          )
          .join("")}
      </div>
      <div class="action-row wrap">
        <button id="cancel-local-btn" class="ghost-btn">Cancel</button>
      </div>
    `;
    ui.promptBody.querySelectorAll("[data-target]").forEach((button) => {
      button.addEventListener("click", () => chooseTarget(button.dataset.target));
    });
    ui.promptBody.querySelector("#cancel-local-btn").addEventListener("click", cancelPendingLocalAction);
    return;
  }

  if (localAction?.kind === "trio" && !localAction.targetId) {
    ui.promptBody.innerHTML = `
      <div>Choose a player for <strong>3 of a Kind</strong>.</div>
      <div class="target-list">
        ${state.room.availableTargets
          .map(
            (target) =>
              `<button class="target-btn" data-target="${target.id}">${escapeHtml(target.name)}</button>`,
          )
          .join("")}
      </div>
      <div class="action-row wrap">
        <button id="cancel-local-btn" class="ghost-btn">Cancel</button>
      </div>
    `;
    ui.promptBody.querySelectorAll("[data-target]").forEach((button) => {
      button.addEventListener("click", () => chooseTarget(button.dataset.target));
    });
    ui.promptBody.querySelector("#cancel-local-btn").addEventListener("click", cancelPendingLocalAction);
    return;
  }

  if (localAction?.kind === "trio" && localAction.targetId) {
    ui.promptBody.innerHTML = `
      <div>Choose which card to request from that player.</div>
      <div class="choice-grid">
        ${state.room.requestOptions
          .map(
            (option) =>
              `<button class="choice-btn choice-with-symbol" data-request="${option.key}"><span class="inline-symbol" aria-hidden="true">${escapeHtml(getCardVisual(option.key).symbol)}</span>${escapeHtml(option.name)}</button>`,
          )
          .join("")}
      </div>
      <div class="action-row wrap">
        <button id="cancel-local-btn" class="ghost-btn">Cancel</button>
      </div>
    `;
    ui.promptBody.querySelectorAll("[data-request]").forEach((button) => {
      button.addEventListener("click", () => chooseRequestedCard(button.dataset.request));
    });
    ui.promptBody.querySelector("#cancel-local-btn").addEventListener("click", cancelPendingLocalAction);
    return;
  }

  if (localAction?.kind === "five") {
    const reclaimableCards = (state.room.discardPile || []).filter((card) => card.reclaimable);
    if (reclaimableCards.length === 0) {
      ui.promptBody.innerHTML = `
        <div>The discard pile does not have a reclaimable card yet.</div>
        <div class="action-row wrap">
          <button id="cancel-local-btn" class="ghost-btn">Cancel</button>
        </div>
      `;
    } else {
      ui.promptBody.innerHTML = `
        <div>Use <strong>5 Different Tools</strong>, then click the discard pile to choose 1 card to reclaim.</div>
        <div class="action-row wrap">
          <button id="open-discard-browser-btn" class="secondary-btn">Open Discard Pile</button>
          <button id="cancel-local-btn" class="ghost-btn">Cancel</button>
        </div>
      `;
      ui.promptBody
        .querySelector("#open-discard-browser-btn")
        .addEventListener("click", openDiscardBrowser);
    }

    ui.promptBody.querySelector("#cancel-local-btn").addEventListener("click", cancelPendingLocalAction);
    return;
  }

  ui.promptBody.textContent = state.room.promptText;
}

function renderLog() {
  ui.logFeed.innerHTML = "";

  if (!state.room || state.room.log.length === 0) {
    ui.logToggleBtn.hidden = true;
    ui.logToggleBtn.disabled = true;
    ui.logToggleBtn.setAttribute("aria-expanded", "false");
    ui.logFeed.innerHTML =
      '<div class="empty-state">The incident log will update as the release unfolds.</div>';
    return;
  }

  const allEntries = state.room.log;
  const canExpand = allEntries.length > LOG_COLLAPSE_COUNT;
  const visibleEntries =
    canExpand && !state.logExpanded ? allEntries.slice(-LOG_COLLAPSE_COUNT) : allEntries;

  ui.logToggleBtn.hidden = !canExpand;
  ui.logToggleBtn.disabled = !canExpand;
  ui.logToggleBtn.textContent = state.logExpanded
    ? `Show Recent ${LOG_COLLAPSE_COUNT}`
    : `Show Full Log (${allEntries.length})`;
  ui.logToggleBtn.setAttribute("aria-expanded", String(state.logExpanded));

  if (canExpand && !state.logExpanded) {
    const summary = document.createElement("div");
    summary.className = "log-summary";
    summary.textContent = `Showing the latest ${LOG_COLLAPSE_COUNT} of ${allEntries.length} events.`;
    ui.logFeed.append(summary);
  }

  visibleEntries.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "log-item";
    item.textContent = entry;
    ui.logFeed.append(item);
  });
}

function renderCrashOverlay() {
  if (!ui.crashOverlay) {
    return;
  }

  if (!state.crashOverlay) {
    ui.crashOverlay.hidden = true;
    ui.crashOverlay.setAttribute("aria-hidden", "true");
    return;
  }

  ui.crashOverlay.hidden = false;
  ui.crashOverlay.setAttribute("aria-hidden", "false");
  ui.crashOverlayTitle.textContent = state.crashOverlay.title;
  ui.crashOverlayText.textContent = state.crashOverlay.text;
}

function renderMoment() {
  if (!ui.momentOverlay) {
    return;
  }

  if (!state.moment) {
    ui.momentOverlay.hidden = true;
    ui.momentOverlay.setAttribute("aria-hidden", "true");
    if (ui.momentArt) {
      ui.momentArt.hidden = true;
      ui.momentArt.style.backgroundImage = "";
    }
    return;
  }

  ui.momentOverlay.hidden = false;
  ui.momentOverlay.setAttribute("aria-hidden", "false");
  ui.momentKicker.textContent = state.moment.kicker;
  ui.momentTitle.textContent = state.moment.title;
  ui.momentText.textContent = state.moment.text;

  const artwork = state.moment.cardKey ? getCardArt(state.moment.cardKey) : null;
  if (ui.momentArt) {
    if (artwork) {
      ui.momentArt.hidden = false;
      ui.momentArt.style.cssText = getCardBackgroundStyle(state.moment.cardKey);
    } else {
      ui.momentArt.hidden = true;
      ui.momentArt.style.cssText = "";
    }
  }
}

function renderPeerReview() {
  if (!ui.reviewOverlay) {
    return;
  }

  if (!state.peerReview) {
    ui.reviewOverlay.hidden = true;
    ui.reviewOverlay.setAttribute("aria-hidden", "true");
    ui.reviewCardGrid.innerHTML = "";
    return;
  }

  ui.reviewOverlay.hidden = false;
  ui.reviewOverlay.setAttribute("aria-hidden", "false");
  ui.reviewMessage.textContent = state.peerReview.message;
  ui.reviewCardGrid.innerHTML = "";

  if (!state.peerReview.cards || state.peerReview.cards.length === 0) {
    ui.reviewCardGrid.innerHTML = '<div class="empty-state">The release queue is empty.</div>';
    return;
  }

  state.peerReview.cards.forEach((card) => {
    const article = document.createElement("article");
    article.className = `review-card ${card.themeClass || ""}`;

    const artwork = getCardArt(card.key);
    const artMarkup = artwork
      ? `<div class="review-card-art" style="${getCardBackgroundStyle(card.key)}" aria-hidden="true"></div>`
      : "";

    article.innerHTML = `
      <div class="review-card-topline">
        <span class="card-tag">${escapeHtml(card.tag)}</span>
        <span class="card-icon" aria-hidden="true">${escapeHtml(getCardVisual(card.key).symbol)}</span>
      </div>
      ${artMarkup}
      <strong class="review-card-name">${escapeHtml(card.name)}</strong>
      <p class="review-card-text">${escapeHtml(card.description)}</p>
    `;

    ui.reviewCardGrid.append(article);
  });
}

function renderDiscardBrowser() {
  if (!ui.discardBrowserOverlay) {
    return;
  }

  if (!state.discardBrowserOpen || !canBrowseDiscardPile()) {
    ui.discardBrowserOverlay.hidden = true;
    ui.discardBrowserOverlay.setAttribute("aria-hidden", "true");
    ui.discardBrowserGrid.innerHTML = "";
    return;
  }

  const discardPile = getDiscardBrowserCards();

  ui.discardBrowserOverlay.hidden = false;
  ui.discardBrowserOverlay.setAttribute("aria-hidden", "false");
  ui.discardBrowserMessage.textContent =
    "Select 1 card from the discard pile to reclaim with 5 Different Tools.";
  ui.discardBrowserGrid.innerHTML = "";

  if (discardPile.length === 0) {
    ui.discardBrowserGrid.innerHTML =
      '<div class="empty-state">The discard pile is empty.</div>';
    return;
  }

  discardPile.forEach((card, index) => {
    const artwork = getCardArt(card.key);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `discard-choice-card ${card.themeClass || ""}${card.reclaimable ? "" : " locked"}`;
    button.disabled = !card.reclaimable;
    button.dataset.discard = card.key;
    button.dataset.index = String(index);

    const artMarkup = artwork
      ? `<div class="discard-choice-art" style="${getCardBackgroundStyle(card.key)}"></div>`
      : `<div class="discard-choice-art discard-choice-fallback">${escapeHtml(getCardVisual(card.key).symbol)}</div>`;

    button.innerHTML = `
      ${artMarkup}
      ${card.reclaimable ? "" : '<span class="discard-choice-lock">Locked</span>'}
    `;

    if (card.reclaimable) {
      button.addEventListener("click", () => chooseDiscardCard(card.key));
    }

    ui.discardBrowserGrid.append(button);
  });
}

function renderComboBar() {
  if (!state.room) {
    ui.comboBar.innerHTML =
      '<div class="empty-state">Select matching tool cards here when your turn starts.</div>';
    return;
  }

  const stats = selectionStats();
  const locked = !!state.room.pendingChoice || !!state.pendingLocalAction || !state.room.canPlay;
  const summary =
    stats.total === 0
      ? "No tool cards selected."
      : `Selected ${stats.total} tool card${stats.total === 1 ? "" : "s"} across ${stats.distinct} type${stats.distinct === 1 ? "" : "s"}.`;

  ui.comboBar.innerHTML = `
    <div class="combo-summary">
      <strong>Combo Tray</strong>
      <span>${escapeHtml(summary)}</span>
    </div>
    <div class="action-row wrap">
      <button id="pair-btn" class="secondary-btn">2 of a Kind</button>
      <button id="trio-btn" class="secondary-btn">3 of a Kind</button>
      <button id="five-btn" class="secondary-btn">5 Different</button>
      <button id="clear-selection-btn" class="ghost-btn">Clear</button>
    </div>
  `;

  ui.comboBar.querySelector("#pair-btn").disabled = locked || !stats.pairReady;
  ui.comboBar.querySelector("#trio-btn").disabled = locked || !stats.trioReady;
  ui.comboBar.querySelector("#five-btn").disabled = locked || !stats.fiveReady;
  ui.comboBar.querySelector("#clear-selection-btn").disabled =
    stats.total === 0 && !state.pendingLocalAction;

  ui.comboBar.querySelector("#pair-btn").addEventListener("click", beginPair);
  ui.comboBar.querySelector("#trio-btn").addEventListener("click", beginTrio);
  ui.comboBar.querySelector("#five-btn").addEventListener("click", beginFive);
  ui.comboBar.querySelector("#clear-selection-btn").addEventListener("click", clearSelections);
}

function renderHand() {
  ui.handGrid.innerHTML = "";

  if (!state.room) {
    ui.handSummary.textContent = "No cards in hand yet.";
    ui.handGrid.innerHTML =
      '<div class="empty-state">Join a room to receive your cards.</div>';
    return;
  }

  const totalCards = state.room.hand.reduce((sum, card) => sum + card.count, 0);
  ui.handSummary.textContent = `${totalCards} card${totalCards === 1 ? "" : "s"} ready.`;

  if (state.room.hand.length === 0) {
    ui.handGrid.innerHTML = '<div class="empty-state">You have no cards in hand.</div>';
    return;
  }

  const handLocked = !!state.room.pendingChoice || !!state.pendingLocalAction;

  state.room.hand.forEach((card) => {
    const selectedCount = state.selectedCounts[card.key] || 0;
    const artwork = getCardArt(card.key);
    const button = document.createElement("button");
    button.className = `card-btn ${card.themeClass}${artwork ? " has-art" : ""}`;

    const clickable =
      !handLocked &&
      ((card.isSnack && state.room.canPlay) || card.turnPlayable);

    button.disabled = !clickable;

    if (selectedCount > 0) {
      button.classList.add("selected");
    }

    button.classList.add("art-only");

    const artMarkup = artwork
      ? `
        <div class="card-art" aria-hidden="true">
          <img class="card-face-image" src="${artwork}" style="${getCardImageStyle(card.key)}" alt="" aria-hidden="true" />
          <div class="card-overlay-meta">
            ${card.count > 1 ? `<span class="count-pill">x${card.count}</span>` : ""}
            ${selectedCount > 0 ? `<span class="selected-pill">Selected ${selectedCount}</span>` : ""}
          </div>
        </div>
      `
      : `<div class="card-fallback-name">${escapeHtml(card.name)}</div>`;

    button.innerHTML = `
      ${artMarkup}
    `;

    button.addEventListener("click", () => playCard(card));
    ui.handGrid.append(button);
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

ui.createRoomBtn.addEventListener("click", createRoom);
ui.joinRoomBtn.addEventListener("click", joinRoom);
ui.leaveRoomBtn.addEventListener("click", leaveRoom);
ui.startGameBtn.addEventListener("click", startGame);
ui.copyRoomBtn.addEventListener("click", copyRoomCode);
ui.drawBtnTop.addEventListener("click", drawCard);
ui.drawBtnBottom.addEventListener("click", drawCard);
ui.logToggleBtn.addEventListener("click", toggleLogExpansion);
if (ui.reviewCloseBtn) {
  ui.reviewCloseBtn.addEventListener("click", hidePeerReview);
}
if (ui.reviewOverlay) {
  ui.reviewOverlay.addEventListener("click", (event) => {
    if (event.target === ui.reviewOverlay) {
      hidePeerReview();
    }
  });
}
if (ui.discardPileBtn) {
  ui.discardPileBtn.addEventListener("click", openDiscardBrowser);
}
if (ui.discardBrowserCloseBtn) {
  ui.discardBrowserCloseBtn.addEventListener("click", closeDiscardBrowser);
}
if (ui.discardBrowserOverlay) {
  ui.discardBrowserOverlay.addEventListener("click", (event) => {
    if (event.target === ui.discardBrowserOverlay) {
      closeDiscardBrowser();
    }
  });
}
ui.roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});
ui.nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    createRoom();
  }
});
ui.nameInput.addEventListener("change", () => {
  rememberPlayerName(getPlayerName());
});

connectSocket();
restoreRoomFromUrl();
render();
