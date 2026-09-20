import { firebaseConfig } from './firebase-config.js';
import { QUESTION_BANK, buildQuestionSet, getQuestionById, shuffle, QUESTION_BANK_COUNT } from './questions.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction, arrayUnion, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

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
  unsubscribe: null,
  room: null,
  roomCode: null,
  role: null,
  round: null,
  question: null,
  questions: [],
  currentAnswer: '',
  currentReaction: null,
  savedQuestions: [],
  demoTimer: null,
  settings: {...DEFAULT_SETTINGS}
};

const $ = (id) => document.getElementById(id);
const qs = (selector, root = document) => [...root.querySelectorAll(selector)];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('wks-settings') || '{}');
    APP_STATE.settings = {...DEFAULT_SETTINGS, ...saved};
  } catch {
    APP_STATE.settings = {...DEFAULT_SETTINGS};
  }
  applySettings();
}

function saveSettings() {
  localStorage.setItem('wks-settings', JSON.stringify(APP_STATE.settings));
  applySettings();
}

function applySettings() {
  document.documentElement.dataset.theme = APP_STATE.settings.theme;
  document.documentElement.dataset.contrast = APP_STATE.settings.highContrast ? 'high' : 'normal';
  document.documentElement.dataset.largeText = APP_STATE.settings.largeText ? 'true' : 'false';
  document.documentElement.dataset.glow = APP_STATE.settings.glow ? 'true' : 'false';
  document.documentElement.dataset.reduceMotion = APP_STATE.settings.reduceMotion || !APP_STATE.settings.animations ? 'true' : 'false';
  $('pixel-field').style.display = APP_STATE.settings.pixels && APP_STATE.settings.particles ? '' : 'none';
  qs('[data-setting]').forEach(button => {
    const key = button.dataset.setting;
    if (key in APP_STATE.settings && typeof APP_STATE.settings[key] === 'boolean') {
      button.classList.toggle('is-on', APP_STATE.settings[key]);
      button.setAttribute('aria-pressed', String(APP_STATE.settings[key]));
    }
  });
  qs('.theme-chip').forEach(chip => chip.classList.toggle('active', chip.dataset.theme === APP_STATE.settings.theme));
}

function initPixels() {
  const field = $('pixel-field');
  field.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 54; i++) {
    const p = document.createElement('span');
    p.className = 'pixel';
    p.style.left = `${Math.random() * 100}%`;
    p.style.top = `${Math.random() * 100}%`;
    p.style.animation = `floatPixel ${5 + Math.random() * 9}s ease-in-out ${Math.random() * -9}s infinite alternate`;
    p.style.opacity = String(.06 + Math.random() * .18);
    fragment.appendChild(p);
  }
  field.appendChild(fragment);
}

const stylePixelAnimation = document.createElement('style');
stylePixelAnimation.textContent = `@keyframes floatPixel{from{transform:translate3d(0,0,0)}to{transform:translate3d(${Math.round(Math.random()*24-12)}px,${Math.round(Math.random()*26-13)}px,0)}}`;
document.head.appendChild(stylePixelAnimation);

function setConnection(online) {
  const pill = $('connection-pill');
  const label = $('connection-label');
  pill.classList.toggle('live', online);
  label.textContent = online ? 'Live multiplayer' : 'Demo mode';
}

function toast(message, icon='✦') {
  $('toast-text').textContent = message;
  $('toast').querySelector('.toast-icon').textContent = icon;
  const layer = $('toast-layer');
  layer.classList.add('open');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => layer.classList.remove('open'), 2400);
}

function playTone(type='tap') {
  if (!APP_STATE.settings.sound) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const now = ctx.currentTime;
    const freq = type === 'success' ? 740 : type === 'reveal' ? 520 : 280;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * (type === 'tap' ? 1.1 : 1.45), now + .08);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === 'success' ? .07 : .035, now + .01);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + .17);
    setTimeout(() => ctx.close(), 300);
  } catch {}
}

function showScreen(name) {
  qs('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  window.scrollTo({top:0, behavior:'smooth'});
}

function setButtonBusy(button, busy, text='Working...') {
  if (!button) return;
  if (busy) {
    button.dataset.defaultText = button.innerText;
    button.disabled = true;
    button.innerText = text;
  } else {
    button.disabled = false;
    button.innerText = button.dataset.defaultText || button.innerText;
  }
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 18);
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

async function uniqueRoomCode() {
  for (let i = 0; i < 6; i++) {
    const code = randomCode();
    const snap = await getDoc(doc(APP_STATE.db, 'rooms', code));
    if (!snap.exists()) return code;
  }
  throw new Error('Could not find an available room code. Try again.');
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

function clearSessionCode() {
  localStorage.removeItem('wks-active-room');
}

function isFirebaseConfigured() {
  return firebaseConfig && !Object.values(firebaseConfig).some(v => String(v).includes('YOUR_'));
}

function buildRoomSettings() {
  const selectedCategory = $('category-mode').value;
  const allowSkip = $('[data-setting="allowSkip"]')?.classList.contains('is-on') ?? true;
  const reactions = $('[data-setting="reactions"]')?.classList.contains('is-on') ?? true;
  return {
    count: Number($('round-count').value),
    mode: selectedCategory,
    allowSkip,
    reactions
  };
}

function hydrateRoomUI(room) {
  APP_STATE.room = room;
  APP_STATE.roomCode = room.code;
  $('room-code-label').textContent = room.code;
  $('room-code-large').textContent = room.code;
  $('game-room-label').textContent = `ROOM ${room.code}`;
  $('host-name-room').textContent = room.hostName || 'Host';
  $('host-avatar').textContent = (room.hostName || 'H').charAt(0).toUpperCase();
  $('waiting-title').textContent = room.guestId ? 'They’re here.' : 'Waiting for someone...';
  $('waiting-subtitle').textContent = room.guestId ? `${room.guestName || 'Player 2'} joined. Ready when you are.` : 'Send the room code. When they arrive, the questions begin.';
  const presence = $('guest-presence');
  presence.classList.toggle('empty', !room.guestId);
  presence.innerHTML = room.guestId
    ? `<span class="avatar">${(room.guestName || 'G').charAt(0).toUpperCase()}</span><div><strong>${escapeHtml(room.guestName || 'Player 2')}</strong><span>connected</span></div><i>✓</i>`
    : `<span class="avatar ghost-avatar">+</span><div><strong>Waiting for player 2</strong><span>share the code above</span></div><i class="pulse-dot"></i>`;
  if (room.hostId === APP_STATE.user?.uid && room.guestId) $('host-start-button').classList.remove('hidden');
  else $('host-start-button').classList.add('hidden');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

async function createRoomOnline() {
  const name = normalizeName($('host-name').value);
  if (!name) return toast('Add your name first.', '✦');
  const button = $('create-confirm');
  setButtonBusy(button, true, 'Creating...');
  try {
    if (!APP_STATE.user) throw new Error('Auth is not ready yet.');
    const code = await uniqueRoomCode();
    const settings = buildRoomSettings();
    const roomQuestions = buildQuestionSet(settings.count, settings.mode);
    const questionIds = roomQuestions.map(q => q.id);
    await setDoc(doc(APP_STATE.db, 'rooms', code), {
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
    saveIdentity(name);
    saveSessionCode(code);
    APP_STATE.role = 'host';
    APP_STATE.roomCode = code;
    await subscribeToRoom(code);
    showScreen('room');
    toast(`Room ${code} is ready.`, '✦');
    playTone('success');
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not create the room.', '×');
  } finally {
    setButtonBusy(button, false);
  }
}

async function joinRoomOnline() {
  const name = normalizeName($('guest-name').value);
  const code = $('room-code').value.trim().toUpperCase();
  $('join-error').textContent = '';
  if (!name) return $('join-error').textContent = 'Add your name first.';
  if (!/^[A-Z0-9]{6}$/.test(code)) return $('join-error').textContent = 'That room code should be six letters or numbers.';
  const button = $('join-confirm');
  setButtonBusy(button, true, 'Joining...');
  try {
    if (!APP_STATE.user) throw new Error('Auth is not ready yet.');
    const roomRef = doc(APP_STATE.db, 'rooms', code);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) throw new Error('Room not found. Check the code and try again.');
    const room = roomSnap.data();
    if (room.guestId && room.guestId !== APP_STATE.user.uid) throw new Error('That room already has two players.');
    if (room.hostId === APP_STATE.user.uid) {
      APP_STATE.role = 'host';
    } else {
      await updateDoc(roomRef, {guestId: APP_STATE.user.uid, guestName: name, lastActivityAt: serverTimestamp()});
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
    console.error(error);
    $('join-error').textContent = error.message || 'Could not join the room.';
  } finally {
    setButtonBusy(button, false);
  }
}

async function subscribeToRoom(code) {
  if (APP_STATE.unsubscribe) APP_STATE.unsubscribe();
  APP_STATE.unsubscribe = onSnapshot(doc(APP_STATE.db, 'rooms', code), snapshot => {
    if (!snapshot.exists()) {
      toast('This room no longer exists.', '×');
      clearRoomState();
      showScreen('home');
      return;
    }
    const room = {id: snapshot.id, ...snapshot.data()};
    hydrateRoomUI(room);
    handleRoomState(room);
  }, error => {
    console.error(error);
    toast('Realtime connection dropped. Refresh to reconnect.', '×');
  });
}

async function handleRoomState(room) {
  if (room.state === 'waiting') {
    return;
  }
  if (room.state === 'question' && room.currentRoundId) {
    await loadRound(room.currentRoundId, room);
    showScreen('game');
  }
  if (room.state === 'reveal' && room.currentRoundId) {
    await loadRound(room.currentRoundId, room);
    await loadAnswersForReveal(room.currentRoundId, room);
    showScreen('reveal');
  }
  if (room.state === 'finished') {
    await prepareResults(room);
    showScreen('results');
  }
}

async function loadRound(roundId, room = APP_STATE.room) {
  const roundSnap = await getDoc(doc(APP_STATE.db, 'rooms', room.code, 'rounds', roundId));
  if (!roundSnap.exists()) return;
  const round = {id: roundSnap.id, ...roundSnap.data()};
  APP_STATE.round = round;
  APP_STATE.question = getQuestionById(round.questionId, room.customQuestions || []);
  if (!APP_STATE.question) return;
  APP_STATE.questions = (room.questionIds || []).map(id => getQuestionById(id, room.customQuestions || [])).filter(Boolean);
  renderGame(round, room);
}

function renderGame(round, room) {
  const index = room.currentIndex ?? 0;
  const total = room.questionIds?.length || room.settings?.count || 20;
  const q = APP_STATE.question;
  $('game-category').textContent = q.category || 'QUESTION';
  $('game-count').textContent = `${index + 1} / ${total}`;
  $('question-serial').textContent = `Q${String(index + 1).padStart(2,'0')}`;
  $('question-text').textContent = q.text;
  $('big-round-number').textContent = String(index + 1).padStart(2, '0');
  $('progress-line-fill').style.width = `${((index + 1) / total) * 100}%`;
  const youName = APP_STATE.role === 'host' ? room.hostName : room.guestName;
  const otherName = APP_STATE.role === 'host' ? room.guestName : room.hostName;
  $('your-status-name').textContent = `${youName || 'You'} · you`;
  $('other-status-name').textContent = otherName || 'Player 2';
  $('your-status-avatar').textContent = (youName || 'Y').charAt(0).toUpperCase();
  $('other-status-avatar').textContent = (otherName || '?').charAt(0).toUpperCase();
  $('answer-input').value = '';
  $('answer-input').disabled = false;
  $('submit-answer').disabled = false;
  $('waiting-answer').classList.add('hidden');
  $('your-status-label').textContent = 'answering';
  $('other-status-label').textContent = 'answering';
  APP_STATE.currentAnswer = '';
  $('char-count').textContent = '0 / 240';
  $('skip-question').disabled = !(room.settings?.allowSkip ?? true);
}

async function submitAnswer() {
  if (!APP_STATE.question || !APP_STATE.room || !APP_STATE.round || !APP_STATE.user) return;
  const answer = $('answer-input').value.trim();
  if (!answer) return toast('Say at least a little something.', '✦');
  const button = $('submit-answer');
  setButtonBusy(button, true, 'Locking...');
  try {
    const roomCode = APP_STATE.room.code;
    const roundId = APP_STATE.round.id;
    const answerRef = doc(APP_STATE.db, 'rooms', roomCode, 'rounds', roundId, 'answers', APP_STATE.user.uid);
    await setDoc(answerRef, {text: answer.slice(0,240), uid: APP_STATE.user.uid, createdAt: serverTimestamp()});
    const roundRef = doc(APP_STATE.db, 'rooms', roomCode, 'rounds', roundId);
    await runTransaction(APP_STATE.db, async tx => {
      const snap = await tx.get(roundRef);
      if (!snap.exists()) throw new Error('Round no longer exists.');
      const submitted = Array.isArray(snap.data().submittedUids) ? snap.data().submittedUids : [];
      if (!submitted.includes(APP_STATE.user.uid)) tx.update(roundRef, {submittedUids: [...submitted, APP_STATE.user.uid], lastActivityAt: serverTimestamp()});
    });
    $('answer-input').disabled = true;
    $('waiting-answer').classList.remove('hidden');
    $('waiting-answer').style.display = 'flex';
    $('your-status-label').textContent = 'locked in';
    playTone('tap');
    await sleep(120);
    const roundSnap = await getDoc(roundRef);
    const submitted = roundSnap.exists() ? (roundSnap.data().submittedUids || []) : [];
    if (submitted.length >= 2) await maybeRevealRound(roomCode, roundId);
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not save your answer.', '×');
  } finally {
    setButtonBusy(button, false);
  }
}

async function maybeRevealRound(roomCode, roundId) {
  try {
    await updateDoc(doc(APP_STATE.db, 'rooms', roomCode), {state: 'reveal', lastActivityAt: serverTimestamp()});
  } catch {}
}

async function loadAnswersForReveal(roundId, room) {
  const ids = [room.hostId, room.guestId].filter(Boolean);
  const answers = {};
  for (const uid of ids) {
    try {
      const snap = await getDoc(doc(APP_STATE.db, 'rooms', room.code, 'rounds', roundId, 'answers', uid));
      if (snap.exists()) answers[uid] = snap.data().text || '';
    } catch (error) {
      console.warn('Could not read answer', error);
    }
  }
  const firstUid = room.hostId;
  const secondUid = room.guestId;
  $('reveal-name-1').textContent = room.hostName || 'Player 1';
  $('reveal-name-2').textContent = room.guestName || 'Player 2';
  $('reveal-avatar-1').textContent = (room.hostName || 'A').charAt(0).toUpperCase();
  $('reveal-avatar-2').textContent = (room.guestName || 'B').charAt(0).toUpperCase();
  $('reveal-answer-1').textContent = answers[firstUid] || 'No answer saved.';
  $('reveal-answer-2').textContent = answers[secondUid] || 'No answer saved.';
  $('reveal-category').textContent = APP_STATE.question?.category || 'REVEAL';
  $('reveal-title').textContent = pickRevealTitle(answers[firstUid] || '', answers[secondUid] || '');
  APP_STATE.round.answers = answers;
  saveLocalRoundAnswer(answers[firstUid] || '', answers[secondUid] || '', roundId);
  playTone('reveal');
}

function pickRevealTitle(a,b) {
  if (!a || !b) return 'Okay... interesting.';
  const score = answerSimilarity(a,b);
  if (score >= 70) return 'Okay... you two are synced.';
  if (score >= 35) return 'Okay... there’s a little overlap.';
  return 'Okay... that went somewhere else.';
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length > 2 && !['the','and','that','this','with','for','you','your','are','was','but','one','would','could','about','from'].includes(w));
}

function answerSimilarity(a,b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let overlap = 0;
  A.forEach(t => { if (B.has(t)) overlap++; });
  const jaccard = overlap / new Set([...A,...B]).size;
  const lengthProximity = 1 - Math.min(1, Math.abs(a.length-b.length)/220);
  return Math.round(Math.min(100, (jaccard * 85) + (lengthProximity * 15)));
}

async function startGameOnline() {
  if (!APP_STATE.room || APP_STATE.role !== 'host') return;
  const questions = APP_STATE.room.questionIds || [];
  if (!questions.length) return toast('No questions are queued.', '×');
  const roundId = `round-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  await setDoc(doc(APP_STATE.db, 'rooms', APP_STATE.room.code, 'rounds', roundId), {
    questionId: questions[0], submittedUids: [], createdAt: serverTimestamp(), reactions: {}
  });
  await updateDoc(doc(APP_STATE.db, 'rooms', APP_STATE.room.code), {state:'question', currentIndex:0, currentRoundId:roundId, lastActivityAt:serverTimestamp()});
}

async function nextQuestionOnline() {
  if (!APP_STATE.room || !APP_STATE.round) return;
  const room = APP_STATE.room;
  const nextIndex = (room.currentIndex ?? 0) + 1;
  if (nextIndex >= (room.questionIds?.length || 0)) {
    if (APP_STATE.role === 'host') {
      await updateDoc(doc(APP_STATE.db, 'rooms', room.code), {state:'finished', lastActivityAt:serverTimestamp()});
    }
    return;
  }
  if (APP_STATE.role !== 'host') return toast('The host moves the session forward. ✦');
  const roundId = `round-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  await setDoc(doc(APP_STATE.db, 'rooms', room.code, 'rounds', roundId), {
    questionId: room.questionIds[nextIndex], submittedUids: [], createdAt: serverTimestamp(), reactions: {}
  });
  await updateDoc(doc(APP_STATE.db, 'rooms', room.code), {state:'question', currentIndex:nextIndex, currentRoundId:roundId, lastActivityAt:serverTimestamp()});
}

async function skipQuestionOnline() {
  if (!APP_STATE.room?.settings?.allowSkip) return;
  const code = APP_STATE.room.code;
  const roundId = APP_STATE.round.id;
  const ref = doc(APP_STATE.db, 'rooms', code, 'rounds', roundId);
  await updateDoc(ref, {skippedBy: arrayUnion(APP_STATE.user.uid)});
  const snap = await getDoc(ref);
  const skipped = snap.exists() ? snap.data().skippedBy || [] : [];
  if (skipped.length >= 2 && APP_STATE.role === 'host') await nextQuestionOnline();
  else toast('Skip sent — waiting for both.', '↷');
}

async function saveReactionOnline(emoji) {
  if (!APP_STATE.room || !APP_STATE.round) return;
  const key = APP_STATE.user?.uid || 'demo';
  await updateDoc(doc(APP_STATE.db, 'rooms', APP_STATE.room.code, 'rounds', APP_STATE.round.id), {[`reactions.${key}`]: emoji});
  toast('Reaction sent.', emoji);
}

async function addCustomQuestionOnline(text) {
  if (APP_STATE.role !== 'host' || !APP_STATE.room) return toast('Only the room host can add questions.', '×');
  const q = {id:`custom-${Date.now()}`, text, category:'Custom', difficulty:'medium'};
  await updateDoc(doc(APP_STATE.db, 'rooms', APP_STATE.room.code), {customQuestions: arrayUnion(q), questionIds: arrayUnion(q.id), lastActivityAt:serverTimestamp()});
  closeModal('custom-question-modal');
  toast('Custom question added.', '✦');
}

async function prepareResults(room) {
  const localHistory = JSON.parse(localStorage.getItem('wks-history') || '[]');
  const last = localHistory.find(h => h.roomCode === room.code);
  const answers = last?.answers || [];
  let shared = 0, different = 0;
  for (const pair of answers) {
    const score = answerSimilarity(pair.a, pair.b);
    if (score >= 55) shared++; else different++;
  }
  const total = shared + different || room.currentIndex + 1 || 1;
  const score = total ? Math.round((shared / total) * 100) : 0;
  $('result-score').textContent = `${score}%`;
  $('shared-count').textContent = String(shared);
  $('different-count').textContent = String(different);
  $('shared-text').textContent = shared ? `${shared} answers had noticeable overlap.` : 'Different answers are still good conversation fuel.';
  $('different-text').textContent = different ? `${different} answers went in different directions.` : 'You were unusually aligned this time.';
  $('session-note').textContent = score >= 70 ? 'Same wavelength. Slightly suspicious.' : score >= 40 ? 'A little sync, a little chaos. Perfect.' : 'Opposites make the most interesting stories.';
}

function saveLocalRoundAnswer(a,b,roundId='') {
  const history = JSON.parse(localStorage.getItem('wks-history') || '[]');
  let session = history.find(h => h.roomCode === APP_STATE.roomCode);
  if (!session) { session = {roomCode:APP_STATE.roomCode, answers:[], createdAt:Date.now()}; history.unshift(session); }
  if (roundId && session.answers.some(item => item.roundId === roundId)) return;
  session.answers.push({a,b,roundId});
  session.answers = session.answers.slice(-50);
  localStorage.setItem('wks-history', JSON.stringify(history.slice(0,10)));
}

function clearRoomState() {
  if (APP_STATE.unsubscribe) { APP_STATE.unsubscribe(); APP_STATE.unsubscribe = null; }
  clearSessionCode();
  APP_STATE.room = null;
  APP_STATE.roomCode = null;
  APP_STATE.role = null;
  APP_STATE.round = null;
}

async function createDemoRoom() {
  const name = normalizeName($('host-name').value);
  if (!name) return toast('Add your name first.', '✦');
  const settings = buildRoomSettings();
  const questionObjects = buildQuestionSet(settings.count, settings.mode).slice(0, settings.count);
  const code = randomCode();
  const demoGuest = 'Midnight Friend';
  APP_STATE.mode = 'demo';
  APP_STATE.role = 'host';
  APP_STATE.roomCode = code;
  APP_STATE.room = {
    code, hostId:'demo-host', guestId:'demo-guest', hostName:name, guestName:demoGuest, state:'waiting',
    questionIds:questionObjects.map(q => q.id), customQuestions:[], currentIndex:0, currentRoundId:null, settings
  };
  APP_STATE.questions = questionObjects;
  saveIdentity(name); saveSessionCode(code);
  hydrateRoomUI(APP_STATE.room);
  showScreen('room');
  toast(`Demo room ${code} created.`, '✦');
  APP_STATE.demoTimer = setTimeout(() => { $('host-start-button').classList.remove('hidden'); hydrateRoomUI(APP_STATE.room); toast('Your demo friend joined.', '↔'); }, 900);
}

function demoStartGame() {
  const room = APP_STATE.room;
  const q = APP_STATE.questions[0];
  APP_STATE.round = {id:'demo-round-1', questionId:q.id, submittedUids:[], answers:{}};
  APP_STATE.question = q;
  room.state = 'question'; room.currentIndex = 0; room.currentRoundId = APP_STATE.round.id;
  renderGame(APP_STATE.round, room);
  showScreen('game');
}

function demoReveal() {
  const myAnswer = $('answer-input').value.trim();
  if (!myAnswer) return toast('Answer it first ✦');
  $('answer-input').disabled = true;
  $('submit-answer').disabled = true;
  $('waiting-answer').style.display = 'flex';
  $('waiting-answer').classList.remove('hidden');
  $('your-status-label').textContent = 'locked in';
  const q = APP_STATE.question.text.toLowerCase();
  const guestAnswers = q.includes('song') ? 'Probably something I listened to way too much in a late-night phase.' : q.includes('food') ? 'Anything spicy that somehow becomes my comfort food.' : 'Honestly? Something simple that reminds me of a really good day.';
  setTimeout(() => {
    APP_STATE.round.answers = {'demo-host':myAnswer, 'demo-guest':guestAnswers};
    $('reveal-name-1').textContent = APP_STATE.room.hostName;
    $('reveal-name-2').textContent = APP_STATE.room.guestName;
    $('reveal-avatar-1').textContent = APP_STATE.room.hostName.charAt(0).toUpperCase();
    $('reveal-avatar-2').textContent = 'M';
    $('reveal-answer-1').textContent = myAnswer;
    $('reveal-answer-2').textContent = guestAnswers;
    $('reveal-category').textContent = APP_STATE.question.category;
    $('reveal-title').textContent = pickRevealTitle(myAnswer, guestAnswers);
    saveLocalRoundAnswer(myAnswer, guestAnswers, APP_STATE.round.id);
    showScreen('reveal');
    playTone('reveal');
  }, 750);
}

function demoNext() {
  const nextIndex = APP_STATE.room.currentIndex + 1;
  if (nextIndex >= APP_STATE.questions.length) {
    prepareResults(APP_STATE.room);
    APP_STATE.room.state = 'finished';
    showScreen('results');
    return;
  }
  APP_STATE.room.currentIndex = nextIndex;
  const q = APP_STATE.questions[nextIndex];
  APP_STATE.question = q;
  APP_STATE.round = {id:`demo-round-${nextIndex+1}`, questionId:q.id, submittedUids:[], answers:{}};
  renderGame(APP_STATE.round, APP_STATE.room);
  showScreen('game');
}

function demoSkip() {
  demoNext();
  toast('Skipped. The next one might be better. ↷');
}

function shareText() {
  const score = $('result-score').textContent;
  return `Wanna Know Something... — ${score} vibe match. We asked better questions. ✦`;
}

async function shareRoom() {
  const text = `Join my Wanna Know Something... room: ${APP_STATE.roomCode}`;
  try {
    if (navigator.share) await navigator.share({title:'Wanna Know Something...', text});
    else { await navigator.clipboard.writeText(text); toast('Share text copied.'); }
  } catch {}
}

async function shareResults() {
  const text = shareText();
  try {
    if (navigator.share) await navigator.share({title:'Wanna Know Something...', text});
    else { await navigator.clipboard.writeText(text); toast('Result text copied.'); }
  } catch {}
}

function openModal(id) { const m = $(id); m.classList.add('open'); m.setAttribute('aria-hidden','false'); }
function closeModal(id) { const m = $(id); m.classList.remove('open'); m.setAttribute('aria-hidden','true'); }

function wireUI() {
  // ------------------------------------------------------------
  // Safe event helpers
  // ------------------------------------------------------------

  const on = (id, event, handler) => {
    const element = $(id);

    if (!element) {
      console.warn(`[WKS] Missing element #${id}`);
      return;
    }

    element.addEventListener(event, handler);
  };

  const onSelector = (selector, event, handler) => {
    const elements = qs(selector);

    if (!elements.length) {
      console.warn(`[WKS] No elements found for "${selector}"`);
      return;
    }

    elements.forEach(element => {
      element.addEventListener(event, handler);
    });
  };

  // ------------------------------------------------------------
  // HOME
  // ------------------------------------------------------------

  on('create-room-button', 'click', () => {
    const hostName = $('host-name');

    if (hostName) {
      hostName.value = getIdentity();
    }

    showScreen('create');
  });

  on('join-room-button', 'click', () => {
    const guestName = $('guest-name');

    if (guestName) {
      guestName.value = getIdentity();
    }

    showScreen('join');
  });

  // IMPORTANT:
  // This used to incorrectly use $() for a CSS selector.
  // $() is for IDs, while qs() is for selectors.
  onSelector('[data-nav="home"]', 'click', e => {
    e.preventDefault();

    clearRoomState();
    showScreen('home');
  });

  // ------------------------------------------------------------
  // BACK BUTTONS
  // ------------------------------------------------------------

  onSelector('[data-back]', 'click', button => {
    const targetScreen = button.dataset.back;

    if (!targetScreen) {
      console.warn('[WKS] Back button is missing data-back');
      return;
    }

    showScreen(targetScreen);
  });

  // ------------------------------------------------------------
  // CREATE / JOIN ROOM
  // ------------------------------------------------------------

  on('create-confirm', 'click', () => {
    const button = $('create-confirm');

    if (button) {
      button.disabled = true;
      button.classList.add('is-loading');
    }

    const action =
      APP_STATE.mode === 'online'
        ? createRoomOnline()
        : createDemoRoom();

    // Re-enable button if the function doesn't navigate away.
    Promise.resolve(action)
      .catch(error => {
        console.error('[WKS] Create room failed:', error);
        toast('Could not create the room. Please try again.', '⚠');
      })
      .finally(() => {
        setTimeout(() => {
          if (button) {
            button.disabled = false;
            button.classList.remove('is-loading');
          }
        }, 500);
      });
  });

  on('join-confirm', 'click', () => {
    const button = $('join-confirm');

    if (button) {
      button.disabled = true;
      button.classList.add('is-loading');
    }

    const action =
      APP_STATE.mode === 'online'
        ? joinRoomOnline()
        : joinDemoRoom();

    Promise.resolve(action)
      .catch(error => {
        console.error('[WKS] Join room failed:', error);
        toast('Could not join the room. Check the code and try again.', '⚠');
      })
      .finally(() => {
        setTimeout(() => {
          if (button) {
            button.disabled = false;
            button.classList.remove('is-loading');
          }
        }, 500);
      });
  });

  // ------------------------------------------------------------
  // ROOM CODE
  // ------------------------------------------------------------

  on('paste-code', 'click', async () => {
    const input = $('room-code');

    if (!input) return;

    try {
      const clipboardText = await navigator.clipboard.readText();

      input.value = clipboardText
        .trim()
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, 6)
        .toUpperCase();

      input.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (error) {
      console.warn('[WKS] Clipboard read failed:', error);
      toast('Clipboard access is blocked here. Paste the code manually.', '⚠');
    }
  });

  on('room-code', 'input', e => {
    e.target.value = e.target.value
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 6)
      .toUpperCase();
  });

  on('copy-room-code', 'click', async () => {
    if (!APP_STATE.roomCode) {
      toast('There is no room code yet.', '⚠');
      return;
    }

    try {
      await navigator.clipboard.writeText(APP_STATE.roomCode);
      toast('Room code copied.', '✦');
    } catch (error) {
      console.warn('[WKS] Clipboard write failed:', error);
      toast(`Room code: ${APP_STATE.roomCode}`, '✦');
    }
  });

  on('share-room', 'click', async () => {
    try {
      await shareRoom();
    } catch (error) {
      console.error('[WKS] Share room failed:', error);
      toast('Could not open sharing. You can copy the room code instead.', '⚠');
    }
  });

  // ------------------------------------------------------------
  // HOST START
  // ------------------------------------------------------------

  on('host-start-button', 'click', async () => {
    try {
      if (APP_STATE.mode === 'online') {
        await startGameOnline();
      } else {
        await demoStartGame();
      }
    } catch (error) {
      console.error('[WKS] Start game failed:', error);
      toast('Could not start the game.', '⚠');
    }
  });

  // ------------------------------------------------------------
  // ANSWERS
  // ------------------------------------------------------------

  on('submit-answer', 'click', async () => {
    const input = $('answer-input');

    if (input) {
      const answer = input.value.trim();

      if (!answer) {
        toast('Write an answer first.', '✦');
        input.focus();
        return;
      }
    }

    try {
      if (APP_STATE.mode === 'online') {
        await submitAnswer();
      } else {
        await demoReveal();
      }
    } catch (error) {
      console.error('[WKS] Submit answer failed:', error);
      toast('Could not submit your answer. Try again.', '⚠');
    }
  });

  // ------------------------------------------------------------
  // SKIP QUESTION
  // ------------------------------------------------------------

  on('skip-question', 'click', async () => {
    try {
      if (APP_STATE.mode === 'online') {
        await skipQuestionOnline();
      } else {
        await demoSkip();
      }
    } catch (error) {
      console.error('[WKS] Skip question failed:', error);
      toast('Could not skip this question.', '⚠');
    }
  });

  // ------------------------------------------------------------
  // NEXT QUESTION
  // ------------------------------------------------------------

  on('next-question', 'click', async () => {
    try {
      if (APP_STATE.mode === 'online') {
        await nextQuestionOnline();
      } else {
        await demoNext();
      }
    } catch (error) {
      console.error('[WKS] Next question failed:', error);
      toast('Could not load the next question.', '⚠');
    }
  });

  // ------------------------------------------------------------
  // PLAY AGAIN
  // ------------------------------------------------------------

  on('play-again', 'click', () => {
    clearRoomState();

    const hostName = $('host-name');

    if (hostName) {
      hostName.value = getIdentity();
    }

    showScreen('create');
  });

  // ------------------------------------------------------------
  // LEAVE ROOM
  // ------------------------------------------------------------

  on('leave-room', 'click', () => {
    clearRoomState();
    showScreen('home');
  });

  // ------------------------------------------------------------
  // SETTINGS
  // ------------------------------------------------------------

  on('settings-button', 'click', () => {
    openModal('settings-modal');
  });

  on('game-settings-button', 'click', () => {
    openModal('settings-modal');
  });

  // ------------------------------------------------------------
  // CUSTOM QUESTIONS
  // ------------------------------------------------------------

  on('custom-question-button', 'click', () => {
    openModal('custom-question-modal');
  });

  on('save-custom-question', 'click', async () => {
    const input = $('custom-question-input');

    if (!input) {
      console.warn('[WKS] Missing custom question input');
      return;
    }

    const text = input.value.trim();

    if (!text) {
      toast('Write a question first.', '⚠');
      input.focus();
      return;
    }

    if (text.length < 5) {
      toast('Make the question a little longer.', '⚠');
      input.focus();
      return;
    }

    if (text.length > 240) {
      toast('Keep the question under 240 characters.', '⚠');
      input.focus();
      return;
    }

    try {
      if (APP_STATE.mode === 'online') {
        await addCustomQuestionOnline(text);
      } else {
        if (!APP_STATE.room) {
          APP_STATE.room = {};
        }

        if (!Array.isArray(APP_STATE.room.customQuestions)) {
          APP_STATE.room.customQuestions = [];
        }

        APP_STATE.room.customQuestions.push({
          id: `custom-${Date.now()}`,
          text,
          category: 'Custom',
          difficulty: 'medium'
        });

        closeModal('custom-question-modal');

        toast('Custom question added.', '✦');
      }

      input.value = '';
    } catch (error) {
      console.error('[WKS] Custom question failed:', error);
      toast('Could not add the question.', '⚠');
    }
  });

  // ------------------------------------------------------------
  // SHARE RESULTS
  // ------------------------------------------------------------

  on('share-results', 'click', async () => {
    try {
      await shareResults();
    } catch (error) {
      console.error('[WKS] Share results failed:', error);
      toast('Could not open sharing.', '⚠');
    }
  });

  // ------------------------------------------------------------
  // FAVORITE ANSWER / QUESTION
  // ------------------------------------------------------------

  on('favorite-answer', 'click', () => {
    const questionId = APP_STATE.question?.id;

    if (!questionId) {
      toast('There is nothing to save yet.', '⚠');
      return;
    }

    let saved = [];

    try {
      saved = JSON.parse(
        localStorage.getItem('wks-saved') || '[]'
      );

      if (!Array.isArray(saved)) {
        saved = [];
      }
    } catch {
      saved = [];
    }

    if (!saved.includes(questionId)) {
      saved.push(questionId);

      localStorage.setItem(
        'wks-saved',
        JSON.stringify(saved)
      );

      const favoriteButton = $('favorite-answer');

      if (favoriteButton) {
        favoriteButton.textContent = '★ Saved';
        favoriteButton.classList.add('saved');
      }

      toast('Question saved.', '★');
    } else {
      toast('Already saved.', '★');
    }
  });

  // ------------------------------------------------------------
  // MODAL CLOSE BUTTONS
  // ------------------------------------------------------------

  onSelector('[data-close-modal]', 'click', button => {
    const modalId = button.dataset.closeModal;

    if (!modalId) return;

    closeModal(modalId);
  });

  // Clicking outside a modal closes it
  onSelector('.modal-backdrop', 'click', event => {
    const backdrop = event.currentTarget;

    if (
      event.target === backdrop &&
      backdrop.id !== 'toast-layer'
    ) {
      closeModal(backdrop.id);
    }
  });

  // ------------------------------------------------------------
  // SETTINGS TOGGLES
  // ------------------------------------------------------------

  onSelector('.switch[data-setting]', 'click', toggle => {
    const key = toggle.dataset.setting;

    if (!key || !(key in APP_STATE.settings)) {
      console.warn(`[WKS] Unknown setting: ${key}`);
      return;
    }

    APP_STATE.settings[key] = !APP_STATE.settings[key];

    saveSettings();

    toggle.setAttribute(
      'aria-checked',
      String(APP_STATE.settings[key])
    );

    toggle.classList.toggle(
      'active',
      APP_STATE.settings[key]
    );

    playTone('tap');
  });

  // ------------------------------------------------------------
  // THEME BUTTONS
  // ------------------------------------------------------------

  onSelector('.theme-chip', 'click', chip => {
    const theme = chip.dataset.theme;

    if (!theme) return;

    APP_STATE.settings.theme = theme;

    saveSettings();

    onSelector('.theme-chip', 'click', () => {});

    qs('.theme-chip').forEach(item => {
      item.classList.toggle(
        'active',
        item.dataset.theme === theme
      );
    });

    playTone('tap');
  });

  // ------------------------------------------------------------
  // ANSWER INPUT
  // ------------------------------------------------------------

  on('answer-input', 'input', event => {
    const counter = $('char-count');

    if (!counter) return;

    counter.textContent =
      `${event.target.value.length} / 240`;
  });

  on('answer-input', 'keydown', event => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey
    ) {
      event.preventDefault();

      const submitButton = $('submit-answer');

      if (submitButton && !submitButton.disabled) {
        submitButton.click();
      }
    }
  });

  // ------------------------------------------------------------
  // REACTIONS
  // ------------------------------------------------------------

  onSelector('.reaction-row button', 'click', async button => {
    qs('.reaction-row button').forEach(
      b => b.classList.remove('selected')
    );

    button.classList.add('selected');

    const emoji = button.dataset.reaction;

    if (!emoji) return;

    APP_STATE.currentReaction = emoji;

    try {
      if (APP_STATE.mode === 'online') {
        await saveReactionOnline(emoji);
      } else {
        toast('Reaction sent.', emoji);
      }
    } catch (error) {
      console.error('[WKS] Reaction failed:', error);
      toast('Could not send reaction.', '⚠');
    }

    playTone('tap');
  });

  // ------------------------------------------------------------
  // GLOBAL KEYBOARD SHORTCUTS
  // ------------------------------------------------------------

  document.addEventListener('keydown', event => {
    // Escape closes open modals
    if (event.key === 'Escape') {
      qs('.modal-backdrop.open').forEach(
        modal => closeModal(modal.id)
      );
      return;
    }

    // Don't trigger shortcuts while typing
    const activeElement = document.activeElement;

    if (
      activeElement &&
      (
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.tagName === 'INPUT'
      )
    ) {
      return;
    }

    // S = skip current question
    if (
      (event.key === 's' || event.key === 'S') &&
      $('screen-game')?.classList.contains('active')
    ) {
      const skipButton = $('skip-question');

      if (skipButton && !skipButton.disabled) {
        skipButton.click();
      }
    }
  });

  // ------------------------------------------------------------
  // INITIAL UI STATE
  // ------------------------------------------------------------

  try {
    const identity = getIdentity();

    const hostName = $('host-name');
    const guestName = $('guest-name');

    if (hostName && !hostName.value) {
      hostName.value = identity;
    }

    if (guestName && !guestName.value) {
      guestName.value = identity;
    }
  } catch (error) {
    console.warn('[WKS] Could not initialize identity:', error);
  }

  console.log('[WKS] UI wired successfully.');
}

function joinDemoRoom() {
  const name = normalizeName($('guest-name').value);
  const code = $('room-code').value.trim().toUpperCase();
  $('join-error').textContent = '';
  if (!name) return $('join-error').textContent='Add your name first.';
  if (!/^[A-Z0-9]{6}$/.test(code)) return $('join-error').textContent='Enter a six-character demo code.';
  const room = {code, hostId:'demo-host', guestId:'demo-guest', hostName:'Demo Host', guestName:name, state:'waiting', questionIds: buildQuestionSet(20,'mixed').map(q=>q.id), customQuestions:[], currentIndex:0, settings:{count:20,mode:'mixed',allowSkip:true,reactions:true}};
  APP_STATE.room = room; APP_STATE.roomCode=code; APP_STATE.role='guest'; APP_STATE.questions=room.questionIds.map(id=>getQuestionById(id)).filter(Boolean); APP_STATE.mode='demo';
  hydrateRoomUI(room); showScreen('room'); toast('Joined the demo room. ✦');
  setTimeout(() => { room.state='question'; APP_STATE.role='guest'; demoStartGame(); }, 900);
}

async function tryRestoreRoom() {
  const code = localStorage.getItem('wks-active-room');
  if (!code) return;
  if (APP_STATE.mode !== 'online' || !APP_STATE.user) return;
  try {
    const snap = await getDoc(doc(APP_STATE.db,'rooms',code));
    if (!snap.exists()) { clearSessionCode(); return; }
    const room = snap.data();
    if (room.hostId !== APP_STATE.user.uid && room.guestId !== APP_STATE.user.uid) { clearSessionCode(); return; }
    APP_STATE.role = room.hostId === APP_STATE.user.uid ? 'host' : 'guest';
    APP_STATE.roomCode = code;
    await subscribeToRoom(code);
    showScreen(room.state==='waiting' ? 'room' : room.state==='question' ? 'game' : room.state==='reveal' ? 'reveal' : 'results');
    toast(`Reconnected to ${code}.`, '↻');
  } catch (error) {
    console.warn('Restore failed', error);
  }
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
    APP_STATE.mode = 'online';
    setConnection(true);
    if (!APP_STATE.auth.currentUser) await signInAnonymously(APP_STATE.auth);
    APP_STATE.user = APP_STATE.auth.currentUser;
    if (!APP_STATE.user) throw new Error('Anonymous authentication did not initialize.');
    await tryRestoreRoom();
  } catch (error) {
    console.error('Firebase init failed:', error);
    APP_STATE.mode='demo';
    setConnection(false);
    toast('Firebase is not connected — switched to Demo Mode.', '✦');
  }
}

function initDefaults() {
  $('host-name').value = getIdentity();
  $('guest-name').value = getIdentity();
  $('round-count').value = '20';
  initPixels();
  loadSettings();
  wireUI();
}

initDefaults();
initFirebase();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
