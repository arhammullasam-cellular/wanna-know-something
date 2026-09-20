import { firebaseConfig } from './firebase-config.js';
import {
  buildQuestionSet,
  getQuestionById,
  QUESTION_BANK_COUNT
} from './questions.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  signInAnonymously
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  arrayUnion,
  serverTimestamp,
  deleteDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const DEFAULT_SETTINGS = {
  particles: true,
  glow: true,
  animations: true,
  pixels: true,
  reduceMotion: false,
  largeText: false,
  highContrast: false,
  sound: true,
  theme: 'midnight'
};

const APP_STATE = {
  mode: 'demo',
  db: null,
  auth: null,
  user: null,
  unsubscribeRoom: null,
  unsubscribeRound: null,
  unsubscribeChat: null,
  room: null,
  roomCode: null,
  role: null,
  round: null,
  question: null,
  questions: [],
  currentReaction: null,
  settings: { ...DEFAULT_SETTINGS },
  lastRenderedRoundId: null,
  lastRevealRoundId: null,
  chatMessages: [],
  chatHydrated: false,
  chatUnread: 0,
  leaveIntent: null,
  demoTimer: null
};

const $ = (id) => document.getElementById(id);
const qs = (selector, root = document) => [...root.querySelectorAll(selector)];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function on(id, event, handler) {
  const el = $(id);
  if (!el) {
    console.warn(`[WKS] Missing #${id}`);
    return;
  }
  el.addEventListener(event, handler);
}

function onAll(selector, event, handler) {
  qs(selector).forEach(el => el.addEventListener(event, handler));
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('wks-settings') || '{}');
    APP_STATE.settings = { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    APP_STATE.settings = { ...DEFAULT_SETTINGS };
  }
  applySettings();
}

function saveSettings() {
  localStorage.setItem('wks-settings', JSON.stringify(APP_STATE.settings));
  applySettings();
}

function applySettings() {
  const root = document.documentElement;
  const s = APP_STATE.settings;

  root.dataset.theme = s.theme;
  root.dataset.contrast = s.highContrast ? 'high' : 'normal';
  root.dataset.largeText = s.largeText ? 'true' : 'false';
  root.dataset.glow = s.glow ? 'true' : 'false';
  root.dataset.animations = s.animations ? 'true' : 'false';
  root.dataset.reduceMotion = (s.reduceMotion || !s.animations) ? 'true' : 'false';

  const pixelField = $('pixel-field');
  if (pixelField) {
    pixelField.style.display = (s.pixels && s.particles) ? '' : 'none';
  }

  qs('[data-setting]').forEach(toggle => {
    const key = toggle.dataset.setting;
    if (key in s && typeof s[key] === 'boolean') {
      toggle.classList.toggle('is-on', s[key]);
      toggle.setAttribute('aria-pressed', String(s[key]));
    }
  });

  qs('.theme-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.theme === s.theme);
  });
}

function initPixels() {
  const field = $('pixel-field');
  if (!field) return;

  field.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < 64; i += 1) {
    const pixel = document.createElement('span');
    pixel.className = 'pixel';
    pixel.style.left = `${Math.random() * 100}%`;
    pixel.style.top = `${Math.random() * 100}%`;
    pixel.style.animationDelay = `${Math.random() * -10}s`;
    pixel.style.animationDuration = `${5 + Math.random() * 9}s`;
    pixel.style.opacity = String(0.06 + Math.random() * 0.18);
    fragment.appendChild(pixel);
  }

  field.appendChild(fragment);
}

function setConnection(online) {
  const pill = $('connection-pill');
  const label = $('connection-label');
  if (!pill || !label) return;

  pill.classList.toggle('live', Boolean(online));
  label.textContent = online ? 'Live multiplayer' : 'Demo mode';
}

function toast(message, icon = '✦') {
  const text = $('toast-text');
  const toastEl = $('toast');
  const layer = $('toast-layer');
  if (!text || !toastEl || !layer) return;

  text.textContent = message;
  const iconEl = toastEl.querySelector('.toast-icon');
  if (iconEl) iconEl.textContent = icon;

  layer.classList.add('open');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => layer.classList.remove('open'), 2800);
}

function playTone(type = 'tap') {
  if (!APP_STATE.settings.sound) return;

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const frequency = type === 'success' ? 740 : type === 'reveal' ? 520 : 280;
    const endFrequency = type === 'tap' ? frequency * 1.1 : frequency * 1.45;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === 'success' ? 0.07 : 0.035, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
    setTimeout(() => ctx.close(), 300);
  } catch {
    // Audio is an enhancement; never let it break gameplay.
  }
}

function showScreen(name, options = {}) {
  const target = qs('.screen').find(screen => screen.dataset.screen === name);
  if (!target) {
    console.warn(`[WKS] Unknown screen: ${name}`);
    return false;
  }

  qs('.screen').forEach(screen => {
    const active = screen === target;
    screen.classList.toggle('active', active);
    screen.setAttribute('aria-hidden', String(!active));
  });

  updateChatAvailability(name);

  if (name === 'home' && !APP_STATE.roomCode) {
    closeModal('settings-modal');
    closeModal('custom-question-modal');
    closeModal('chat-modal');
  }

  const behavior = APP_STATE.settings.reduceMotion ? 'auto' : 'smooth';
  try {
    window.scrollTo({ top: 0, behavior });
  } catch {
    window.scrollTo(0, 0);
  }

  return true;
}

function requestLeaveGame(source = 'button') {
  APP_STATE.leaveIntent = { source, roomCode: APP_STATE.roomCode };
  const copy = $('leave-game-copy');
  const room = APP_STATE.room;
  const isHost = APP_STATE.role === 'host';

  if (copy) {
    if (isHost) {
      copy.textContent = room?.guestId
        ? 'You are the host. Leaving will end this room for both players.'
        : 'This room will be closed and the room code will stop working.';
    } else {
      copy.textContent = 'You will leave this room. The other player can continue or invite someone else.';
    }
  }

  openModal('leave-game-modal');
}

function handleBackAction(button) {
  const current = qs('.screen').find(screen => screen.classList.contains('active'))?.dataset.screen || 'home';
  const target = button?.dataset?.back || 'home';

  if (current === 'home') return;

  // While inside a live room/game, Back means Leave rather than silently
  // destroying the multiplayer session.
  if (APP_STATE.roomCode && ['room', 'game', 'reveal', 'results'].includes(current)) {
    requestLeaveGame('back');
    return;
  }

  closeModal('settings-modal');
  closeModal('custom-question-modal');
  closeModal('chat-modal');
  showScreen(target);
  playTone('tap');
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  const focusTarget = modal.querySelector('input, textarea, button:not([data-close-modal])');
  if (focusTarget) setTimeout(() => focusTarget.focus(), 50);
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');

  if (!qs('.modal-backdrop.open').length) {
    document.body.classList.remove('modal-open');
  }
}

function setButtonBusy(button, busy, text = 'Working...') {
  if (!button) return;

  if (busy) {
    if (!button.dataset.defaultText) button.dataset.defaultText = button.innerText;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerText = text;
  } else {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.innerText = button.dataset.defaultText || button.innerText;
  }
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 18);
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function saveIdentity(name) {
  localStorage.setItem('wks-name', name);
}

function getIdentity() {
  return localStorage.getItem('wks-name') || '';
}

function saveSessionCode(code) {
  localStorage.setItem('wks-active-room', code);
}

function getSessionCode() {
  return localStorage.getItem('wks-active-room') || '';
}

function clearSessionCode() {
  localStorage.removeItem('wks-active-room');
}

function clearRealtimeSubscriptions() {
  if (APP_STATE.unsubscribeRoom) {
    APP_STATE.unsubscribeRoom();
    APP_STATE.unsubscribeRoom = null;
  }
  if (APP_STATE.unsubscribeRound) {
    APP_STATE.unsubscribeRound();
    APP_STATE.unsubscribeRound = null;
  }
  if (APP_STATE.unsubscribeChat) {
    APP_STATE.unsubscribeChat();
    APP_STATE.unsubscribeChat = null;
  }
}

function clearRoomState() {
  clearRealtimeSubscriptions();
  clearTimeout(APP_STATE.demoTimer);
  clearSessionCode();

  APP_STATE.room = null;
  APP_STATE.roomCode = null;
  APP_STATE.role = null;
  APP_STATE.round = null;
  APP_STATE.question = null;
  APP_STATE.questions = [];
  APP_STATE.currentReaction = null;
  APP_STATE.lastRenderedRoundId = null;
  APP_STATE.lastRevealRoundId = null;
  APP_STATE.chatMessages = [];
  APP_STATE.chatHydrated = false;
  APP_STATE.chatUnread = 0;
}


function updateChatAvailability(screenName) {
  const button = $('chat-button');
  if (!button) return;

  const canChat = Boolean(
    APP_STATE.roomCode &&
    APP_STATE.room &&
    ['room', 'reveal', 'results'].includes(screenName)
  );

  button.classList.toggle('hidden', !canChat);
  button.setAttribute('aria-hidden', String(!canChat));

  if (!canChat && $('chat-modal')?.classList.contains('open')) {
    closeModal('chat-modal');
  }

  const badge = $('chat-unread-badge');
  if (badge) {
    badge.textContent = APP_STATE.chatUnread > 9 ? '9+' : String(APP_STATE.chatUnread);
    badge.classList.toggle('hidden', APP_STATE.chatUnread <= 0);
  }
}

function formatChatTime(value) {
  try {
    const date = value?.toDate ? value.toDate() : new Date(value || Date.now());
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  } catch {
    return '';
  }
}

function renderChatMessages(messages = []) {
  const list = $('chat-messages');
  if (!list) return;

  list.replaceChildren();

  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.innerHTML = '<strong>It’s quiet here.</strong><span>Send the first message while you wait.</span>';
    list.appendChild(empty);
    return;
  }

  messages.forEach(message => {
    const mine = message.uid === APP_STATE.user?.uid || message.uid === 'demo-host';
    const bubble = document.createElement('article');
    bubble.className = `chat-message ${mine ? 'mine' : 'theirs'}`;

    const meta = document.createElement('div');
    meta.className = 'chat-message-meta';

    const name = document.createElement('strong');
    name.textContent = mine ? 'You' : (message.name || 'Player');

    const time = document.createElement('time');
    time.textContent = formatChatTime(message.createdAt);

    meta.append(name, time);

    const text = document.createElement('p');
    text.textContent = message.text || '';

    bubble.append(meta, text);
    list.appendChild(bubble);
  });

  requestAnimationFrame(() => {
    list.scrollTop = list.scrollHeight;
  });
}

function markChatRead() {
  APP_STATE.chatUnread = 0;
  const badge = $('chat-unread-badge');
  if (badge) badge.classList.add('hidden');
}

function openChat() {
  if (!APP_STATE.roomCode || !APP_STATE.room) return;
  openModal('chat-modal');
  markChatRead();
  setTimeout(() => $('chat-input')?.focus(), 80);
}

async function sendChatMessage() {
  const input = $('chat-input');
  const text = String(input?.value || '').trim().slice(0, 500);
  if (!text) {
    input?.focus();
    return;
  }

  if (!APP_STATE.roomCode || !APP_STATE.user || !APP_STATE.db) {
    const message = {
      id: `demo-chat-${Date.now()}`,
      uid: 'demo-host',
      name: APP_STATE.room?.hostName || getIdentity() || 'You',
      text,
      createdAt: new Date()
    };
    APP_STATE.chatMessages.push(message);
    renderChatMessages(APP_STATE.chatMessages);
    input.value = '';
    return;
  }

  const button = $('send-chat');
  setButtonBusy(button, true, 'Sending...');

  try {
    await addDoc(collection(APP_STATE.db, 'rooms', APP_STATE.roomCode, 'messages'), {
      uid: APP_STATE.user.uid,
      name: APP_STATE.role === 'host' ? (APP_STATE.room.hostName || 'Host') : (APP_STATE.room.guestName || 'Player 2'),
      text,
      createdAt: serverTimestamp()
    });

    input.value = '';
    playTone('tap');
  } catch (error) {
    console.error('[WKS] chat send:', error);
    toast(friendlyFirebaseError(error, 'Could not send that message.'), '×');
  } finally {
    setButtonBusy(button, false);
    input?.focus();
  }
}

function subscribeToChat(code) {
  if (!APP_STATE.db || !code) return;

  if (APP_STATE.unsubscribeChat) APP_STATE.unsubscribeChat();
  APP_STATE.chatHydrated = false;
  APP_STATE.chatUnread = 0;

  const messagesRef = collection(APP_STATE.db, 'rooms', code, 'messages');
  const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'), limit(100));

  APP_STATE.unsubscribeChat = onSnapshot(
    messagesQuery,
    snapshot => {
      const messages = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      const added = snapshot.docChanges().filter(change => change.type === 'added');

      if (APP_STATE.chatHydrated) {
        const incomingCount = added.filter(change => change.doc.data().uid !== APP_STATE.user?.uid).length;
        if (incomingCount && !$('chat-modal')?.classList.contains('open')) {
          APP_STATE.chatUnread += incomingCount;
          updateChatAvailability(document.querySelector('.screen.active')?.dataset.screen || '');
          playTone('tap');
        }
      }

      APP_STATE.chatMessages = messages;
      renderChatMessages(messages);
      APP_STATE.chatHydrated = true;
    },
    error => {
      console.error('[WKS] chat listener:', error);
      toast(friendlyFirebaseError(error, 'Could not load the room chat.'), '×');
    }
  );
}

function isFirebaseConfigured() {
  if (!firebaseConfig || typeof firebaseConfig !== 'object') return false;
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  return required.every(key => {
    const value = String(firebaseConfig[key] || '');
    return value && !value.includes('YOUR_');
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

function buildRoomSettings() {
  const roundCount = Number($('round-count')?.value || 20);
  const mode = $('category-mode')?.value || 'mixed';
  const allowSkip = qs('.switch[data-setting="allowSkip"]')[0]?.classList.contains('is-on') ?? true;
  const reactions = qs('.switch[data-setting="reactions"]')[0]?.classList.contains('is-on') ?? true;

  return {
    count: [5, 10, 20, 30, 50].includes(roundCount) ? roundCount : 20,
    mode,
    allowSkip,
    reactions
  };
}

function hydrateRoomUI(room) {
  APP_STATE.room = room;
  APP_STATE.roomCode = room.code;

  const roomCodeLabel = $('room-code-label');
  const roomCodeLarge = $('room-code-large');
  const gameRoomLabel = $('game-room-label');
  const hostNameRoom = $('host-name-room');
  const hostAvatar = $('host-avatar');
  const waitingTitle = $('waiting-title');
  const waitingSubtitle = $('waiting-subtitle');
  const presence = $('guest-presence');
  const startButton = $('host-start-button');

  if (roomCodeLabel) roomCodeLabel.textContent = room.code || '------';
  if (roomCodeLarge) roomCodeLarge.textContent = room.code || '------';
  if (gameRoomLabel) gameRoomLabel.textContent = `ROOM ${room.code || '------'}`;
  if ($('chat-room-label')) $('chat-room-label').textContent = `ROOM ${room.code || '------'}`;
  if (hostNameRoom) hostNameRoom.textContent = room.hostName || 'Host';
  if (hostAvatar) hostAvatar.textContent = (room.hostName || 'H').charAt(0).toUpperCase();
  if (waitingTitle) waitingTitle.textContent = room.guestId ? 'They’re here.' : 'Waiting for someone...';
  if (waitingSubtitle) {
    waitingSubtitle.textContent = room.guestId
      ? `${room.guestName || 'Player 2'} joined. Ready when you are.`
      : 'Send the room code. When they arrive, the questions begin.';
  }

  if (presence) {
    presence.classList.toggle('empty', !room.guestId);
    presence.innerHTML = room.guestId
      ? `<span class="avatar">${escapeHtml((room.guestName || 'G').charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(room.guestName || 'Player 2')}</strong><span>connected</span></div><i>✓</i>`
      : `<span class="avatar ghost-avatar">+</span><div><strong>Waiting for player 2</strong><span>share the code above</span></div><i class="pulse-dot"></i>`;
  }

  if (startButton) {
    const canStart = APP_STATE.role === 'host' && Boolean(room.guestId) && room.state === 'waiting';
    startButton.classList.toggle('hidden', !canStart);
  }
}

function renderGame(round, room, force = false) {
  const q = APP_STATE.question;
  if (!q) return;

  const isNewRound = force || APP_STATE.lastRenderedRoundId !== round.id;
  const index = room.currentIndex ?? 0;
  const total = room.questionIds?.length || room.settings?.count || 20;

  if (isNewRound) {
    const answerInput = $('answer-input');
    if (answerInput) {
      answerInput.value = '';
      answerInput.disabled = false;
    }

    APP_STATE.currentReaction = null;
    APP_STATE.lastRenderedRoundId = round.id;

    if ($('char-count')) $('char-count').textContent = '0 / 240';
    if ($('waiting-answer')) $('waiting-answer').classList.add('hidden');
    if ($('submit-answer')) $('submit-answer').disabled = false;
    if ($('favorite-answer')) $('favorite-answer').textContent = '☆ Save this question';
    qs('.reaction-row button').forEach(button => button.classList.remove('selected'));
  }

  if ($('game-category')) $('game-category').textContent = q.category || 'QUESTION';
  if ($('game-count')) $('game-count').textContent = `${index + 1} / ${total}`;
  if ($('question-serial')) $('question-serial').textContent = `Q${String(index + 1).padStart(2, '0')}`;
  if ($('question-text')) $('question-text').textContent = q.text;
  if ($('big-round-number')) $('big-round-number').textContent = String(index + 1).padStart(2, '0');
  if ($('progress-line-fill')) $('progress-line-fill').style.width = `${Math.min(100, ((index + 1) / total) * 100)}%`;

  const youName = APP_STATE.role === 'host' ? room.hostName : room.guestName;
  const otherName = APP_STATE.role === 'host' ? room.guestName : room.hostName;

  if ($('your-status-name')) $('your-status-name').textContent = `${youName || 'You'} · you`;
  if ($('other-status-name')) $('other-status-name').textContent = otherName || 'Player 2';
  if ($('your-status-avatar')) $('your-status-avatar').textContent = (youName || 'Y').charAt(0).toUpperCase();
  if ($('other-status-avatar')) $('other-status-avatar').textContent = (otherName || '?').charAt(0).toUpperCase();

  const submitted = Array.isArray(round.submittedUids) ? round.submittedUids : [];
  const skipped = Array.isArray(round.skippedBy) ? round.skippedBy : [];
  const youSubmitted = Boolean(APP_STATE.user && submitted.includes(APP_STATE.user.uid));
  const otherId = APP_STATE.role === 'host' ? room.guestId : room.hostId;
  const otherSubmitted = Boolean(otherId && submitted.includes(otherId));
  const yourSkipped = Boolean(APP_STATE.user && skipped.includes(APP_STATE.user.uid));

  if ($('your-status-label')) $('your-status-label').textContent = youSubmitted ? 'locked in' : yourSkipped ? 'skipping' : 'answering';
  if ($('other-status-label')) $('other-status-label').textContent = otherSubmitted ? 'locked in' : (skipped.includes(otherId) ? 'skipping' : 'answering');
  qs('.status-light').forEach((light, indexLight) => {
    const active = indexLight === 0 ? youSubmitted : otherSubmitted;
    light.classList.toggle('active', !active);
    light.classList.toggle('waiting', active);
  });

  if ($('answer-input')) $('answer-input').disabled = youSubmitted;
  if ($('submit-answer')) $('submit-answer').disabled = youSubmitted;
  if ($('waiting-answer')) {
    const showWaiting = youSubmitted;
    $('waiting-answer').classList.toggle('hidden', !showWaiting);
    $('waiting-answer').style.display = showWaiting ? 'flex' : '';
  }

  if ($('skip-question')) {
    $('skip-question').disabled = !(room.settings?.allowSkip ?? true) || skipped.includes(APP_STATE.user?.uid);
    $('skip-question').textContent = yourSkipped ? 'Skip sent' : 'Skip question';
  }

  if ($('skip-hint')) {
    $('skip-hint').style.opacity = (room.settings?.allowSkip ?? true) ? '1' : '.35';
  }

  if ($('reaction-row')) {
    $('reaction-row').style.display = room.settings?.reactions === false ? 'none' : '';
  }
}

async function createRoomOnline() {
  const name = normalizeName($('host-name')?.value);
  if (!name) {
    toast('Add your name first.', '✦');
    $('host-name')?.focus();
    return;
  }

  const button = $('create-confirm');
  setButtonBusy(button, true, 'Creating...');

  try {
    if (!APP_STATE.user || !APP_STATE.db) throw new Error('Firebase is still connecting. Try again in a moment.');

    const settings = buildRoomSettings();
    const roomQuestions = buildQuestionSet(settings.count, settings.mode).slice(0, settings.count);
    const questionIds = roomQuestions.map(q => q.id);
    if (!questionIds.length) throw new Error('No questions are available for this room.');

    let roomCode = '';

    await runTransaction(APP_STATE.db, async transaction => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = randomCode();
        const roomRef = doc(APP_STATE.db, 'rooms', code);
        const existing = await transaction.get(roomRef);

        if (existing.exists()) continue;

        transaction.set(roomRef, {
          code,
          hostId: APP_STATE.user.uid,
          guestId: null,
          hostName: name,
          guestName: null,
          state: 'waiting',
          questionIds,
          customQuestions: [],
          currentIndex: 0,
          currentRoundId: null,
          settings,
          createdAt: serverTimestamp(),
          lastActivityAt: serverTimestamp()
        });

        roomCode = code;
        return;
      }

      throw new Error('Could not generate a free room code. Please try again.');
    });

    saveIdentity(name);
    saveSessionCode(roomCode);
    APP_STATE.role = 'host';
    APP_STATE.roomCode = roomCode;

    await subscribeToRoom(roomCode);
    showScreen('room');
    toast(`Room ${roomCode} is ready.`, '✦');
    playTone('success');
  } catch (error) {
    console.error('[WKS] create room:', error);
    toast(friendlyFirebaseError(error, 'Could not create the room.'), '×');
  } finally {
    setButtonBusy(button, false);
  }
}

async function joinRoomOnline() {
  const name = normalizeName($('guest-name')?.value);
  const code = String($('room-code')?.value || '').trim().toUpperCase();
  const errorEl = $('join-error');
  if (errorEl) errorEl.textContent = '';

  if (!name) {
    if (errorEl) errorEl.textContent = 'Add your name first.';
    $('guest-name')?.focus();
    return;
  }

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    if (errorEl) errorEl.textContent = 'That room code should be six letters or numbers.';
    $('room-code')?.focus();
    return;
  }

  const button = $('join-confirm');
  setButtonBusy(button, true, 'Joining...');

  try {
    if (!APP_STATE.user || !APP_STATE.db) throw new Error('Firebase is still connecting. Try again in a moment.');

    const roomRef = doc(APP_STATE.db, 'rooms', code);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) throw new Error('Room not found. Check the code and try again.');

    const room = roomSnap.data();
    if (!room.hostId) throw new Error('That room is invalid.');
    if (room.state !== 'waiting') throw new Error('That game has already started.');
    if (room.guestId && room.guestId !== APP_STATE.user.uid) throw new Error('That room already has two players.');

    if (room.hostId === APP_STATE.user.uid) {
      APP_STATE.role = 'host';
    } else {
      await updateDoc(roomRef, {
        guestId: APP_STATE.user.uid,
        guestName: name,
        lastActivityAt: serverTimestamp()
      });
      APP_STATE.role = 'guest';
    }

    saveIdentity(name);
    saveSessionCode(code);
    APP_STATE.roomCode = code;

    await subscribeToRoom(code);
    showScreen('room');
    toast('You’re in. ✦', '✦');
    playTone('success');
  } catch (error) {
    console.error('[WKS] join room:', error);
    if (errorEl) errorEl.textContent = friendlyFirebaseError(error, 'Could not join the room.');
  } finally {
    setButtonBusy(button, false);
  }
}

function friendlyFirebaseError(error, fallback) {
  const code = error?.code || '';
  const message = String(error?.message || '');

  if (code === 'permission-denied') return 'Firebase blocked this action. Make sure Anonymous Auth is enabled and the latest Firestore rules are published.';
  if (code === 'auth/operation-not-allowed') return 'Anonymous sign-in is disabled in Firebase Authentication.';
  if (code === 'auth/unauthorized-domain') return 'This website domain is not authorized in Firebase Authentication.';
  if (/Missing or insufficient permissions/i.test(message)) return 'Firestore rules are not published yet, or they do not match this app.';
  return message || fallback;
}

async function subscribeToRoom(code) {
  if (!APP_STATE.db) return;

  if (APP_STATE.unsubscribeRoom) APP_STATE.unsubscribeRoom();
  if (APP_STATE.unsubscribeRound) APP_STATE.unsubscribeRound();

  subscribeToChat(code);

  APP_STATE.unsubscribeRoom = onSnapshot(
    doc(APP_STATE.db, 'rooms', code),
    snapshot => {
      if (!snapshot.exists()) {
        toast('This room no longer exists.', '×');
        clearRoomState();
        showScreen('home');
        return;
      }

      const room = { id: snapshot.id, ...snapshot.data() };
      APP_STATE.room = room;
      APP_STATE.roomCode = room.code;
      hydrateRoomUI(room);
      syncRoomState(room).catch(error => console.error('[WKS] room state:', error));
    },
    error => {
      console.error('[WKS] room listener:', error);
      toast(friendlyFirebaseError(error, 'Realtime connection dropped. Refresh to reconnect.'), '×');
    }
  );
}

async function syncRoomState(room) {
  if (room.state === 'closed') {
    const message = room.closedBy === APP_STATE.user?.uid
      ? 'Room closed.'
      : 'The host ended the game.';
    clearRoomState();
    showScreen('home');
    toast(message, '↪');
    return;
  }

  if (room.state === 'waiting') {
    if (APP_STATE.unsubscribeRound) {
      APP_STATE.unsubscribeRound();
      APP_STATE.unsubscribeRound = null;
    }
    return;
  }

  if (room.state === 'question' || room.state === 'reveal') {
    if (!room.currentRoundId) return;
    subscribeToRound(room);
    return;
  }

  if (room.state === 'finished') {
    if (APP_STATE.unsubscribeRound) {
      APP_STATE.unsubscribeRound();
      APP_STATE.unsubscribeRound = null;
    }
    await prepareResults(room);
    showScreen('results');
  }
}

function subscribeToRound(room) {
  if (!APP_STATE.db || !room.currentRoundId) return;

  const sameRound = APP_STATE.round?.id === room.currentRoundId && APP_STATE.unsubscribeRound;
  if (sameRound) {
    if (room.state === 'reveal' && APP_STATE.lastRevealRoundId !== room.currentRoundId) {
      APP_STATE.lastRevealRoundId = room.currentRoundId;
      showReveal(room).catch(error => console.error('[WKS] reveal:', error));
    }
    return;
  }

  if (APP_STATE.unsubscribeRound) APP_STATE.unsubscribeRound();

  const roundRef = doc(APP_STATE.db, 'rooms', room.code, 'rounds', room.currentRoundId);
  APP_STATE.unsubscribeRound = onSnapshot(
    roundRef,
    snapshot => {
      if (!snapshot.exists()) return;

      const round = { id: snapshot.id, ...snapshot.data() };
      APP_STATE.round = round;
      APP_STATE.question = getQuestionById(round.questionId, room.customQuestions || []);
      APP_STATE.questions = (room.questionIds || [])
        .map(id => getQuestionById(id, room.customQuestions || []))
        .filter(Boolean);

      if (room.state === 'question') {
        renderGame(round, room);
        showScreen('game');

        const submitted = Array.isArray(round.submittedUids) ? round.submittedUids : [];
        if (submitted.length >= 2 && APP_STATE.role === 'host') {
          revealRound(room).catch(error => console.error('[WKS] reveal transition:', error));
        }

        const skipped = Array.isArray(round.skippedBy) ? round.skippedBy : [];
        if (skipped.length >= 2 && APP_STATE.role === 'host') {
          nextQuestionOnline().catch(error => console.error('[WKS] skip advance:', error));
        }
      }

      if (room.state === 'reveal') {
        renderGame(round, room);
        showReveal(room).catch(error => console.error('[WKS] reveal:', error));
      }
    },
    error => {
      console.error('[WKS] round listener:', error);
      toast(friendlyFirebaseError(error, 'Could not sync this question.'), '×');
    }
  );
}

async function revealRound(room) {
  if (APP_STATE.role !== 'host' || room.state !== 'question' || !room.currentRoundId) return;

  try {
    await updateDoc(doc(APP_STATE.db, 'rooms', room.code), {
      state: 'reveal',
      lastActivityAt: serverTimestamp()
    });
  } catch (error) {
    console.error('[WKS] reveal round:', error);
  }
}

async function showReveal(room) {
  if (!APP_STATE.round || !APP_STATE.question) return;
  if (APP_STATE.lastRevealRoundId === APP_STATE.round.id) {
    showScreen('reveal');
    return;
  }

  APP_STATE.lastRevealRoundId = APP_STATE.round.id;

  try {
    const hostAnswerRef = doc(APP_STATE.db, 'rooms', room.code, 'rounds', APP_STATE.round.id, 'answers', room.hostId);
    const guestAnswerRef = doc(APP_STATE.db, 'rooms', room.code, 'rounds', APP_STATE.round.id, 'answers', room.guestId);
    const [hostSnap, guestSnap] = await Promise.all([getDoc(hostAnswerRef), getDoc(guestAnswerRef)]);

    const hostAnswer = hostSnap.exists() ? hostSnap.data().text || '' : '';
    const guestAnswer = guestSnap.exists() ? guestSnap.data().text || '' : '';

    renderRevealAnswers(room, hostAnswer, guestAnswer);
    saveLocalRoundAnswer(hostAnswer, guestAnswer, APP_STATE.round.id);
    showScreen('reveal');
    playTone('reveal');
  } catch (error) {
    console.error('[WKS] reveal answers:', error);
    toast(friendlyFirebaseError(error, 'Could not load both answers.'), '×');
  }
}

function renderRevealAnswers(room, hostAnswer, guestAnswer) {
  if ($('reveal-name-1')) $('reveal-name-1').textContent = room.hostName || 'Player 1';
  if ($('reveal-name-2')) $('reveal-name-2').textContent = room.guestName || 'Player 2';
  if ($('reveal-avatar-1')) $('reveal-avatar-1').textContent = (room.hostName || 'A').charAt(0).toUpperCase();
  if ($('reveal-avatar-2')) $('reveal-avatar-2').textContent = (room.guestName || 'B').charAt(0).toUpperCase();
  if ($('reveal-answer-1')) $('reveal-answer-1').textContent = hostAnswer || 'No answer saved.';
  if ($('reveal-answer-2')) $('reveal-answer-2').textContent = guestAnswer || 'No answer saved.';
  if ($('reveal-category')) $('reveal-category').textContent = APP_STATE.question?.category || 'REVEAL';
  if ($('reveal-title')) $('reveal-title').textContent = pickRevealTitle(hostAnswer, guestAnswer);

  APP_STATE.round.answers = {
    [room.hostId]: hostAnswer,
    [room.guestId]: guestAnswer
  };
}

function pickRevealTitle(a, b) {
  if (!a || !b) return 'Okay... interesting.';
  const score = answerSimilarity(a, b);
  if (score >= 70) return 'Okay... you two are synced.';
  if (score >= 35) return 'Okay... there’s a little overlap.';
  return 'Okay... that went somewhere else.';
}

function tokenize(text) {
  const stopWords = new Set([
    'the', 'and', 'that', 'this', 'with', 'for', 'you', 'your', 'are',
    'was', 'but', 'one', 'would', 'could', 'about', 'from', 'have', 'has',
    'what', 'when', 'where', 'into', 'then', 'just', 'like', 'really'
  ]);

  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

function answerSimilarity(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;

  let overlap = 0;
  A.forEach(token => {
    if (B.has(token)) overlap += 1;
  });

  const unionSize = new Set([...A, ...B]).size;
  const jaccard = unionSize ? overlap / unionSize : 0;
  const lengthProximity = 1 - Math.min(1, Math.abs(String(a).length - String(b).length) / 220);

  return Math.round(Math.min(100, (jaccard * 85) + (lengthProximity * 15)));
}

async function startGameOnline() {
  if (!APP_STATE.room || APP_STATE.role !== 'host') return;

  const room = APP_STATE.room;
  if (!room.guestId) {
    toast('Wait for the second player to join.', '✦');
    return;
  }

  const questions = room.questionIds || [];
  if (!questions.length) {
    toast('No questions are queued.', '×');
    return;
  }

  const button = $('host-start-button');
  setButtonBusy(button, true, 'Starting...');

  try {
    const roundId = `round-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await setDoc(doc(APP_STATE.db, 'rooms', room.code, 'rounds', roundId), {
      questionId: questions[0],
      submittedUids: [],
      skippedBy: [],
      reactions: {},
      createdAt: serverTimestamp(),
      lastActivityAt: serverTimestamp()
    });

    await updateDoc(doc(APP_STATE.db, 'rooms', room.code), {
      state: 'question',
      currentIndex: 0,
      currentRoundId: roundId,
      lastActivityAt: serverTimestamp()
    });
  } catch (error) {
    console.error('[WKS] start game:', error);
    toast(friendlyFirebaseError(error, 'Could not start the game.'), '×');
  } finally {
    setButtonBusy(button, false);
  }
}

async function nextQuestionOnline() {
  if (!APP_STATE.room || !APP_STATE.round || APP_STATE.role !== 'host') return;
  if (APP_STATE.room.state !== 'reveal' && APP_STATE.room.state !== 'question') return;

  const room = APP_STATE.room;
  const nextIndex = (room.currentIndex ?? 0) + 1;

  try {
    if (nextIndex >= (room.questionIds?.length || 0)) {
      await updateDoc(doc(APP_STATE.db, 'rooms', room.code), {
        state: 'finished',
        lastActivityAt: serverTimestamp()
      });
      return;
    }

    const nextQuestion = room.questionIds[nextIndex];
    const roundId = `round-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    await setDoc(doc(APP_STATE.db, 'rooms', room.code, 'rounds', roundId), {
      questionId: nextQuestion,
      submittedUids: [],
      skippedBy: [],
      reactions: {},
      createdAt: serverTimestamp(),
      lastActivityAt: serverTimestamp()
    });

    await updateDoc(doc(APP_STATE.db, 'rooms', room.code), {
      state: 'question',
      currentIndex: nextIndex,
      currentRoundId: roundId,
      lastActivityAt: serverTimestamp()
    });
  } catch (error) {
    console.error('[WKS] next question:', error);
    toast(friendlyFirebaseError(error, 'Could not load the next question.'), '×');
  }
}

async function submitAnswer() {
  if (!APP_STATE.question || !APP_STATE.room || !APP_STATE.round || !APP_STATE.user) return;

  const input = $('answer-input');
  const answer = String(input?.value || '').trim().slice(0, 240);
  if (!answer) {
    toast('Say at least a little something.', '✦');
    input?.focus();
    return;
  }

  const button = $('submit-answer');
  setButtonBusy(button, true, 'Locking...');

  try {
    const roomCode = APP_STATE.room.code;
    const roundId = APP_STATE.round.id;
    const answerRef = doc(APP_STATE.db, 'rooms', roomCode, 'rounds', roundId, 'answers', APP_STATE.user.uid);
    const roundRef = doc(APP_STATE.db, 'rooms', roomCode, 'rounds', roundId);

    await setDoc(answerRef, {
      text: answer,
      uid: APP_STATE.user.uid,
      createdAt: serverTimestamp()
    });

    await runTransaction(APP_STATE.db, async transaction => {
      const snapshot = await transaction.get(roundRef);
      if (!snapshot.exists()) throw new Error('This question no longer exists.');

      const data = snapshot.data();
      const submitted = Array.isArray(data.submittedUids) ? data.submittedUids : [];

      if (!submitted.includes(APP_STATE.user.uid)) {
        transaction.update(roundRef, {
          submittedUids: [...submitted, APP_STATE.user.uid],
          lastActivityAt: serverTimestamp()
        });
      }
    });

    if (input) input.disabled = true;
    if ($('waiting-answer')) {
      $('waiting-answer').classList.remove('hidden');
      $('waiting-answer').style.display = 'flex';
    }

    if ($('your-status-label')) $('your-status-label').textContent = 'locked in';
    playTone('tap');
  } catch (error) {
    console.error('[WKS] submit answer:', error);
    toast(friendlyFirebaseError(error, 'Could not save your answer.'), '×');
  } finally {
    setButtonBusy(button, false);
  }
}

async function skipQuestionOnline() {
  if (!APP_STATE.room?.settings?.allowSkip || !APP_STATE.round || !APP_STATE.user) return;

  try {
    const roundRef = doc(APP_STATE.db, 'rooms', APP_STATE.room.code, 'rounds', APP_STATE.round.id);
    await updateDoc(roundRef, {
      skippedBy: arrayUnion(APP_STATE.user.uid),
      lastActivityAt: serverTimestamp()
    });
    toast('Skip sent — waiting for both.', '↷');
  } catch (error) {
    console.error('[WKS] skip:', error);
    toast(friendlyFirebaseError(error, 'Could not skip this question.'), '×');
  }
}

async function saveReactionOnline(emoji) {
  if (!APP_STATE.room || !APP_STATE.round || !APP_STATE.user) return;

  try {
    await updateDoc(
      doc(APP_STATE.db, 'rooms', APP_STATE.room.code, 'rounds', APP_STATE.round.id),
      { [`reactions.${APP_STATE.user.uid}`]: emoji, lastActivityAt: serverTimestamp() }
    );
    toast('Reaction sent.', emoji);
  } catch (error) {
    console.error('[WKS] reaction:', error);
    toast(friendlyFirebaseError(error, 'Could not send reaction.'), '×');
  }
}

async function addCustomQuestionOnline(text) {
  if (APP_STATE.role !== 'host' || !APP_STATE.room) {
    toast('Only the room host can add questions.', '×');
    return;
  }

  const question = {
    id: `custom-${Date.now()}`,
    text: String(text).trim().slice(0, 180),
    category: 'Custom',
    difficulty: 'medium'
  };

  try {
    await updateDoc(doc(APP_STATE.db, 'rooms', APP_STATE.room.code), {
      customQuestions: arrayUnion(question),
      questionIds: arrayUnion(question.id),
      lastActivityAt: serverTimestamp()
    });

    closeModal('custom-question-modal');
    $('custom-question-input').value = '';
    toast('Custom question added.', '✦');
  } catch (error) {
    console.error('[WKS] custom question:', error);
    toast(friendlyFirebaseError(error, 'Could not add the question.'), '×');
  }
}

function saveLocalRoundAnswer(a, b, roundId = '') {
  try {
    const history = JSON.parse(localStorage.getItem('wks-history') || '[]');
    let session = history.find(item => item.roomCode === APP_STATE.roomCode);

    if (!session) {
      session = {
        roomCode: APP_STATE.roomCode,
        answers: [],
        createdAt: Date.now()
      };
      history.unshift(session);
    }

    if (roundId && session.answers.some(item => item.roundId === roundId)) return;

    session.answers.push({ a, b, roundId });
    session.answers = session.answers.slice(-50);
    localStorage.setItem('wks-history', JSON.stringify(history.slice(0, 10)));
  } catch {
    // Local history is optional.
  }
}

async function prepareResults(room) {
  let answers = [];
  try {
    const history = JSON.parse(localStorage.getItem('wks-history') || '[]');
    const session = history.find(item => item.roomCode === room.code);
    answers = session?.answers || [];
  } catch {
    answers = [];
  }

  let shared = 0;
  let different = 0;

  for (const pair of answers) {
    const score = answerSimilarity(pair.a, pair.b);
    if (score >= 55) shared += 1;
    else different += 1;
  }

  const total = shared + different;
  const score = total ? Math.round((shared / total) * 100) : 0;

  if ($('result-score')) $('result-score').textContent = `${score}%`;
  if ($('shared-count')) $('shared-count').textContent = String(shared);
  if ($('different-count')) $('different-count').textContent = String(different);
  if ($('shared-text')) $('shared-text').textContent = shared ? `${shared} answers had noticeable overlap.` : 'Different answers are still good conversation fuel.';
  if ($('different-text')) $('different-text').textContent = different ? `${different} answers went in different directions.` : 'You were unusually aligned this time.';
  if ($('session-note')) {
    $('session-note').textContent = score >= 70
      ? 'Same wavelength. Slightly suspicious.'
      : score >= 40
        ? 'A little sync, a little chaos. Perfect.'
        : 'Opposites make the most interesting stories.';
  }
}

async function leaveRoomOnline() {
  const room = APP_STATE.room;
  const uid = APP_STATE.user?.uid;
  const db = APP_STATE.db;

  if (!room || !uid || !db) {
    clearRoomState();
    showScreen('home');
    return;
  }

  const roomRef = doc(db, 'rooms', room.code);

  try {
    if (APP_STATE.role === 'host' && room.hostId === uid) {
      // Mark the room closed first so the other phone receives a clean
      // realtime state transition before this client disconnects.
      await updateDoc(roomRef, {
        state: 'closed',
        closedBy: uid,
        closedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp()
      });
      toast('Game ended. The room is closed.', '↪');
    } else if (APP_STATE.role === 'guest' && room.guestId === uid) {
      // The host keeps the room. Reset it to waiting so a new guest can join.
      await updateDoc(roomRef, {
        guestId: null,
        guestName: null,
        state: 'waiting',
        currentRoundId: null,
        currentIndex: 0,
        lastActivityAt: serverTimestamp()
      });
      toast('You left the room.', '↪');
    }
  } catch (error) {
    console.warn('[WKS] leave room:', error);
    toast(friendlyFirebaseError(error, 'Could not update the room. Leaving locally anyway.'), '⚠');
  }

  clearRoomState();
  showScreen('home');
}

function leaveRoomDemo() {
  clearRoomState();
  showScreen('home');
  toast('You left the room.', '↪');
}

function createDemoRoom() {
  const name = normalizeName($('host-name')?.value);
  if (!name) {
    toast('Add your name first.', '✦');
    return;
  }

  const settings = buildRoomSettings();
  const questionObjects = buildQuestionSet(settings.count, settings.mode).slice(0, settings.count);
  const code = randomCode();

  APP_STATE.mode = 'demo';
  APP_STATE.role = 'host';
  APP_STATE.roomCode = code;
  APP_STATE.room = {
    code,
    hostId: 'demo-host',
    guestId: 'demo-guest',
    hostName: name,
    guestName: 'Midnight Friend',
    state: 'waiting',
    questionIds: questionObjects.map(q => q.id),
    customQuestions: [],
    currentIndex: 0,
    currentRoundId: null,
    settings
  };
  APP_STATE.questions = questionObjects;
  saveIdentity(name);
  saveSessionCode(code);
  hydrateRoomUI(APP_STATE.room);
  APP_STATE.chatMessages = [];
  APP_STATE.chatHydrated = true;
  renderChatMessages([]);
  showScreen('room');
  toast(`Demo room ${code} created.`, '✦');

  clearTimeout(APP_STATE.demoTimer);
  APP_STATE.demoTimer = setTimeout(() => {
    if (!APP_STATE.room) return;
    const startButton = $('host-start-button');
    if (startButton) startButton.classList.remove('hidden');
    toast('Your demo friend joined.', '↔');
  }, 800);
}

function demoStartGame() {
  const room = APP_STATE.room;
  const q = APP_STATE.questions[0];
  if (!room || !q) return;

  APP_STATE.round = {
    id: 'demo-round-1',
    questionId: q.id,
    submittedUids: [],
    skippedBy: [],
    answers: {}
  };
  APP_STATE.question = q;
  APP_STATE.lastRenderedRoundId = null;
  room.state = 'question';
  room.currentIndex = 0;
  room.currentRoundId = APP_STATE.round.id;
  renderGame(APP_STATE.round, room, true);
  showScreen('game');
}

function demoReveal() {
  const input = $('answer-input');
  const myAnswer = String(input?.value || '').trim();
  if (!myAnswer) {
    toast('Answer it first ✦');
    input?.focus();
    return;
  }

  if (input) input.disabled = true;
  if ($('submit-answer')) $('submit-answer').disabled = true;
  if ($('waiting-answer')) {
    $('waiting-answer').style.display = 'flex';
    $('waiting-answer').classList.remove('hidden');
  }
  if ($('your-status-label')) $('your-status-label').textContent = 'locked in';

  const prompt = String(APP_STATE.question?.text || '').toLowerCase();
  const guestAnswer = prompt.includes('song')
    ? 'Probably something I listened to way too much in a late-night phase.'
    : prompt.includes('food')
      ? 'Anything spicy that somehow becomes my comfort food.'
      : 'Honestly? Something simple that reminds me of a really good day.';

  setTimeout(() => {
    APP_STATE.round.answers = {
      'demo-host': myAnswer,
      'demo-guest': guestAnswer
    };

    renderRevealAnswers(APP_STATE.room, myAnswer, guestAnswer);
    saveLocalRoundAnswer(myAnswer, guestAnswer, APP_STATE.round.id);
    showScreen('reveal');
    playTone('reveal');
  }, 650);
}

function demoNext() {
  const room = APP_STATE.room;
  if (!room) return;

  const nextIndex = room.currentIndex + 1;
  if (nextIndex >= APP_STATE.questions.length) {
    room.state = 'finished';
    prepareResults(room);
    showScreen('results');
    return;
  }

  room.currentIndex = nextIndex;
  const q = APP_STATE.questions[nextIndex];
  APP_STATE.question = q;
  APP_STATE.round = {
    id: `demo-round-${nextIndex + 1}`,
    questionId: q.id,
    submittedUids: [],
    skippedBy: [],
    answers: {}
  };
  APP_STATE.lastRenderedRoundId = null;
  APP_STATE.lastRevealRoundId = null;
  renderGame(APP_STATE.round, room, true);
  showScreen('game');
}

function demoSkip() {
  demoNext();
  toast('Skipped. The next one might be better. ↷');
}

function joinDemoRoom() {
  const name = normalizeName($('guest-name')?.value);
  const code = String($('room-code')?.value || '').trim().toUpperCase();
  const errorEl = $('join-error');
  if (errorEl) errorEl.textContent = '';

  if (!name) {
    if (errorEl) errorEl.textContent = 'Add your name first.';
    return;
  }

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    if (errorEl) errorEl.textContent = 'Enter a six-character demo code.';
    return;
  }

  const questionObjects = buildQuestionSet(20, 'mixed').slice(0, 20);
  APP_STATE.mode = 'demo';
  APP_STATE.role = 'guest';
  APP_STATE.roomCode = code;
  APP_STATE.questions = questionObjects;
  APP_STATE.room = {
    code,
    hostId: 'demo-host',
    guestId: 'demo-guest',
    hostName: 'Demo Host',
    guestName: name,
    state: 'waiting',
    questionIds: questionObjects.map(q => q.id),
    customQuestions: [],
    currentIndex: 0,
    currentRoundId: null,
    settings: {
      count: 20,
      mode: 'mixed',
      allowSkip: true,
      reactions: true
    }
  };

  hydrateRoomUI(APP_STATE.room);
  APP_STATE.chatMessages = [];
  APP_STATE.chatHydrated = true;
  renderChatMessages([]);
  showScreen('room');
  toast('Joined the demo room. ✦');

  setTimeout(() => demoStartGame(), 900);
}

async function tryRestoreRoom() {
  const code = getSessionCode();
  if (!code || APP_STATE.mode !== 'online' || !APP_STATE.user || !APP_STATE.db) return;

  try {
    const snap = await getDoc(doc(APP_STATE.db, 'rooms', code));
    if (!snap.exists()) {
      clearSessionCode();
      return;
    }

    const room = snap.data();
    if (room.hostId !== APP_STATE.user.uid && room.guestId !== APP_STATE.user.uid) {
      clearSessionCode();
      return;
    }

    APP_STATE.role = room.hostId === APP_STATE.user.uid ? 'host' : 'guest';
    APP_STATE.roomCode = code;
    await subscribeToRoom(code);
    hydrateRoomUI(room);

    const destination = room.state === 'waiting'
      ? 'room'
      : room.state === 'question'
        ? 'game'
        : room.state === 'reveal'
          ? 'reveal'
          : 'results';

    showScreen(destination);
    toast(`Reconnected to ${code}.`, '↻');
  } catch (error) {
    console.warn('[WKS] restore failed:', error);
  }
}

function shareRoom() {
  const code = APP_STATE.roomCode;
  if (!code) return;

  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  url.hash = 'join';

  const text = `Join my Wanna Know Something... room: ${code}`;

  if (navigator.share) {
    navigator.share({
      title: 'Wanna Know Something...',
      text,
      url: url.toString()
    }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(`${text}\n${url.toString()}`)
      .then(() => toast('Invite copied.'))
      .catch(() => toast(`Room code: ${code}`));
  }
}

function shareText() {
  const score = $('result-score')?.textContent || '—';
  return `Wanna Know Something... — ${score} vibe match. We asked better questions. ✦`;
}

function shareResults() {
  const text = shareText();

  if (navigator.share) {
    navigator.share({
      title: 'Wanna Know Something...',
      text
    }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text)
      .then(() => toast('Result text copied.'))
      .catch(() => toast(text));
  }
}

function handleRoomLink() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = String(params.get('room') || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return;

  const input = $('room-code');
  if (input) input.value = roomCode;

  showScreen('join');
  history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash || ''}`);
  toast(`Room ${roomCode} ready to join.`, '↗');
}

function wireUI() {
  // Home actions
  on('create-room-button', 'click', () => {
    const input = $('host-name');
    if (input) input.value = getIdentity();
    showScreen('create');
    playTone('tap');
  });

  on('join-room-button', 'click', () => {
    const input = $('guest-name');
    if (input) input.value = getIdentity();
    showScreen('join');
    playTone('tap');
  });

  // Navigation is delegated so Back keeps working even if a screen is
  // replaced/re-rendered later.
  document.addEventListener('click', event => {
    const navHome = event.target.closest('[data-nav="home"]');
    const backButton = event.target.closest('[data-back]');

    if (navHome) {
      event.preventDefault();
      if (APP_STATE.roomCode) {
        requestLeaveGame('home-nav');
      } else {
        clearRoomState();
        showScreen('home');
      }
      return;
    }

    if (backButton) {
      event.preventDefault();
      handleBackAction(backButton);
    }
  });

  // Create / join
  on('create-confirm', 'click', () => {
    if (APP_STATE.mode === 'online') createRoomOnline();
    else createDemoRoom();
  });

  on('join-confirm', 'click', () => {
    if (APP_STATE.mode === 'online') joinRoomOnline();
    else joinDemoRoom();
  });

  on('paste-code', 'click', async () => {
    const input = $('room-code');
    if (!input) return;

    try {
      const value = await navigator.clipboard.readText();
      input.value = value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      toast('Clipboard access is blocked here. Paste the code manually.', '⚠');
    }
  });

  on('room-code', 'input', event => {
    event.target.value = event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
  });

  // Room actions
  on('copy-room-code', 'click', async () => {
    if (!APP_STATE.roomCode) return;

    try {
      await navigator.clipboard.writeText(APP_STATE.roomCode);
      toast('Room code copied.', '✦');
    } catch {
      toast(`Room code: ${APP_STATE.roomCode}`, '✦');
    }
  });

  on('share-room', 'click', shareRoom);
  on('host-start-button', 'click', () => {
    if (APP_STATE.mode === 'online') startGameOnline();
    else demoStartGame();
  });

  on('leave-room', 'click', () => requestLeaveGame('room-leave'));
  on('leave-game-button', 'click', () => requestLeaveGame('game-leave'));
  on('leave-game-reveal', 'click', () => requestLeaveGame('reveal-leave'));
  on('leave-game-results', 'click', () => requestLeaveGame('results-leave'));
  on('cancel-leave-game', 'click', () => {
    APP_STATE.leaveIntent = null;
    closeModal('leave-game-modal');
  });
  on('confirm-leave-game', 'click', async () => {
    closeModal('leave-game-modal');
    APP_STATE.leaveIntent = null;
    if (APP_STATE.mode === 'online') await leaveRoomOnline();
    else leaveRoomDemo();
  });

  on('custom-question-button', 'click', () => openModal('custom-question-modal'));

  on('save-custom-question', 'click', () => {
    const input = $('custom-question-input');
    const text = String(input?.value || '').trim();

    if (!text) {
      toast('Write a question first.', '⚠');
      input?.focus();
      return;
    }
    if (text.length < 5) {
      toast('Make the question a little longer.', '⚠');
      input?.focus();
      return;
    }

    if (APP_STATE.mode === 'online') {
      addCustomQuestionOnline(text);
    } else {
      if (!APP_STATE.room.customQuestions) APP_STATE.room.customQuestions = [];
      APP_STATE.room.customQuestions.push({
        id: `custom-${Date.now()}`,
        text: text.slice(0, 180),
        category: 'Custom',
        difficulty: 'medium'
      });
      closeModal('custom-question-modal');
      input.value = '';
      toast('Custom question added.', '✦');
    }
  });

  // Game
  on('submit-answer', 'click', () => {
    if (APP_STATE.mode === 'online') submitAnswer();
    else demoReveal();
  });

  on('skip-question', 'click', () => {
    if (APP_STATE.mode === 'online') skipQuestionOnline();
    else demoSkip();
  });

  on('next-question', 'click', () => {
    if (APP_STATE.mode === 'online') nextQuestionOnline();
    else demoNext();
  });

  on('answer-input', 'input', event => {
    const counter = $('char-count');
    if (counter) counter.textContent = `${event.target.value.length} / 240`;
  });

  on('answer-input', 'keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('submit-answer')?.click();
    }
  });

  // Results
  on('share-results', 'click', shareResults);
  on('play-again', 'click', () => {
    clearRoomState();
    const input = $('host-name');
    if (input) input.value = getIdentity();
    showScreen('create');
  });

  on('favorite-answer', 'click', () => {
    const id = APP_STATE.question?.id;
    if (!id) return;

    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem('wks-saved') || '[]');
      if (!Array.isArray(saved)) saved = [];
    } catch {
      saved = [];
    }

    if (!saved.includes(id)) {
      saved.push(id);
      localStorage.setItem('wks-saved', JSON.stringify(saved));
      if ($('favorite-answer')) $('favorite-answer').textContent = '★ Saved';
      toast('Question saved.', '★');
    } else {
      toast('Already saved.', '★');
    }
  });

  // Chat
  on('chat-button', 'click', openChat);
  on('chat-form', 'submit', event => {
    event.preventDefault();
    sendChatMessage();
  });
  on('chat-input', 'keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  });

  // Settings
  on('settings-button', 'click', () => openModal('settings-modal'));
  on('game-settings-button', 'click', () => openModal('settings-modal'));

  onAll('[data-close-modal]', 'click', button => {
    closeModal(button.dataset.closeModal);
  });

  onAll('.modal-backdrop', 'click', event => {
    if (event.target === event.currentTarget) closeModal(event.currentTarget.id);
  });

  onAll('.switch[data-setting]', 'click', button => {
    const key = button.dataset.setting;

    // allowSkip/reactions are room settings, not global settings.
    if (key === 'allowSkip' || key === 'reactions') {
      button.classList.toggle('is-on');
      button.setAttribute('aria-pressed', String(button.classList.contains('is-on')));
      playTone('tap');
      return;
    }

    if (!(key in APP_STATE.settings)) return;
    APP_STATE.settings[key] = !APP_STATE.settings[key];
    saveSettings();
    playTone('tap');
  });

  onAll('.theme-chip', 'click', chip => {
    const theme = chip.dataset.theme;
    if (!theme) return;
    APP_STATE.settings.theme = theme;
    saveSettings();
    playTone('tap');
  });

  // Reactions
  onAll('.reaction-row button', 'click', async button => {
    qs('.reaction-row button').forEach(item => item.classList.remove('selected'));
    button.classList.add('selected');
    APP_STATE.currentReaction = button.dataset.reaction || null;

    if (APP_STATE.mode === 'online') {
      await saveReactionOnline(APP_STATE.currentReaction);
    } else {
      toast('Reaction sent.', APP_STATE.currentReaction || '✦');
    }

    playTone('tap');
  });

  // Keyboard
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      qs('.modal-backdrop.open').forEach(modal => closeModal(modal.id));
      return;
    }

    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
    if (typing) return;

    if ((event.key === 's' || event.key === 'S') && $('screen-game')?.classList.contains('active')) {
      $('skip-question')?.click();
    }
  });
}

async function initFirebase() {
  if (!isFirebaseConfigured()) {
    APP_STATE.mode = 'demo';
    setConnection(false);
    toast(`Demo mode · ${QUESTION_BANK_COUNT} questions loaded`, '✦');
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    APP_STATE.auth = getAuth(app);
    APP_STATE.db = getFirestore(app);

    if (!APP_STATE.auth.currentUser) {
      await signInAnonymously(APP_STATE.auth);
    }

    APP_STATE.user = APP_STATE.auth.currentUser;
    if (!APP_STATE.user) throw new Error('Anonymous authentication did not initialize.');

    APP_STATE.mode = 'online';
    setConnection(true);
    await tryRestoreRoom();
  } catch (error) {
    console.error('[WKS] Firebase init failed:', error);
    APP_STATE.mode = 'demo';
    setConnection(false);
    toast(friendlyFirebaseError(error, 'Firebase is not connected — switched to Demo Mode.'), '⚠');
  }
}

function initDefaults() {
  const identity = getIdentity();
  if ($('host-name')) $('host-name').value = identity;
  if ($('guest-name')) $('guest-name').value = identity;
  if ($('round-count')) $('round-count').value = '20';

  initPixels();
  loadSettings();
  wireUI();
  handleRoomLink();
}

initDefaults();
initFirebase();

window.addEventListener('online', () => {
  if (APP_STATE.mode === 'online') setConnection(true);
});

window.addEventListener('offline', () => {
  if (APP_STATE.mode === 'online') {
    setConnection(false);
    toast('You are offline. Reconnecting when the internet returns.', '⚠');
  }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('[WKS] service worker:', error));
}
