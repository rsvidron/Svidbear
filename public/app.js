import { BEARS, MATCHES, ROUND_LABELS, EVENT, PHOTOS } from '/data.js';
import { createStore } from '/store.js';

const MATCH_BY_ID = new Map(MATCHES.map((m) => [m.id, m]));
const FINAL = MATCHES[MATCHES.length - 1];
const STORAGE_KEY = 'svidbear.bracket.v1';

/** matchId -> bear id. Whatever the board is currently showing. */
let picks = {};
/** Your own picks, parked here while the board shows somebody else's. */
let myPicks = null;
/** { id, name } while viewing another person's bracket; null when it's yours. */
let viewing = null;
/** 'bracket' or 'pool' */
let view = 'bracket';
let entryId = null;
let entryName = '';
let store = null;
let account = null;

const isViewing = () => viewing !== null;

const $ = (sel) => document.querySelector(sel);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/* ── Bracket model ──────────────────────────────────────── */

function participants(match) {
  if (match.slots) return match.slots.slice();
  return match.from.map((id) => winnerOf(id));
}

function winnerOf(matchId) {
  const pick = picks[matchId];
  if (!pick) return null;
  return participants(MATCH_BY_ID.get(matchId)).includes(pick) ? pick : null;
}

/** Drop any pick whose bear no longer reaches that matchup. Rounds resolve in order. */
function prune() {
  for (const match of MATCHES) {
    const pick = picks[match.id];
    if (pick && !participants(match).includes(pick)) delete picks[match.id];
  }
}

function pickCount() {
  return MATCHES.filter((m) => picks[m.id]).length;
}

function isComplete() {
  return pickCount() === MATCHES.length;
}

/** Compact 0/1/- string, one character per matchup, for sharing. */
function encodePicks() {
  return MATCHES.map((m) => {
    const idx = participants(m).indexOf(picks[m.id]);
    return idx < 0 ? '-' : String(idx);
  }).join('');
}

function decodePicks(code) {
  picks = {};
  if (typeof code !== 'string') return;
  MATCHES.forEach((match, i) => {
    const ch = code[i];
    if (ch !== '0' && ch !== '1') return;
    const bear = participants(match)[Number(ch)];
    if (bear) picks[match.id] = bear;
  });
}

/** Server entries store slot indices; convert for the API. */
function picksAsIndices() {
  return MATCHES.map((m) => {
    const idx = participants(m).indexOf(picks[m.id]);
    return idx < 0 ? null : idx;
  });
}

/* ── Rendering ──────────────────────────────────────────── */

function bearLabel(id) {
  const bear = BEARS[id];
  return bear?.nickname ? `${bear.nickname}` : `Bear ${id}`;
}

/** Who could still arrive in this slot, for the "awaiting winner" placeholder. */
function feederNames(match, index) {
  const feeder = MATCH_BY_ID.get(match.from[index]);
  return participants(feeder)
    .map((bear, i) => bear ?? (feeder.slots ? feeder.slots[i] : '?'))
    .join(' / ');
}

function buildSlot(match, index, bearId) {
  const row = el('div', 'slot');

  if (!bearId) {
    row.classList.add('slot--empty');
    const main = el('button', 'slot__main');
    main.type = 'button';
    main.disabled = true;
    main.append(el('span', 'slot__face slot__face--blank'));
    const body = el('div', 'slot__body');
    body.append(
      el('span', 'slot__name', 'Awaiting winner'),
      el('span', 'slot__meta', feederNames(match, index))
    );
    main.append(body);
    row.append(main);
    return row;
  }

  const bear = BEARS[bearId];
  const picked = picks[match.id] === bearId;
  if (picked) row.classList.add('slot--picked');
  else if (picks[match.id]) row.classList.add('slot--out');

  const main = el('button', 'slot__main');
  main.type = 'button';
  main.dataset.match = match.id;
  main.dataset.bear = bearId;
  main.setAttribute('aria-label', `Read the dossier for bear ${bearId}, ${bearLabel(bearId)}`);

  // A phone shows this as a half-width tile; a desktop row shows it at 34px.
  const face = el('img', 'slot__face');
  face.src = `/bears/${bearId}-sm.webp`;
  face.srcset = `/bears/${bearId}-sm.webp 192w, /bears/${bearId}-md.webp 448w`;
  face.sizes = '(max-width: 1000px) 46vw, 34px';
  face.alt = '';
  face.loading = 'lazy';
  face.decoding = 'async';
  face.width = 192;
  face.height = 192;
  main.append(face);

  const name = el('span', 'slot__name');
  name.append(el('span', 'slot__num', bearId));
  if (bear.nickname) name.append(el('span', 'slot__nick', bear.nickname));

  const body = el('div', 'slot__body');
  body.append(name, el('span', 'slot__meta', bear.class));
  main.append(body);

  if (isViewing()) {
    row.append(main);
    return row;
  }

  const pick = el('button', 'slot__pick');
  pick.type = 'button';
  pick.dataset.match = match.id;
  pick.dataset.bear = bearId;
  pick.setAttribute('aria-pressed', String(picked));
  pick.setAttribute(
    'aria-label',
    picked ? `Undo advancing bear ${bearId}` : `Advance bear ${bearId} to the next round`
  );
  pick.append(el('span', 'slot__check', '✓'), el('span', 'slot__picklabel', picked ? 'Picked' : 'Pick'));

  row.append(main, pick);
  return row;
}

function buildMatch(match) {
  const node = el('div', 'match');
  node.dataset.match = match.id;
  // A matchup still waiting on a feeder collapses to a compact card on a phone
  // rather than reserving space for photos of bears nobody has picked yet.
  if (participants(match).some((bear) => !bear)) node.classList.add('match--pending');
  if (match.round > 0) node.classList.add('has-in');
  if (match.id !== FINAL.id) node.classList.add('has-out');
  if (match.id === FINAL.id) node.classList.add('match--final', 'has-in');

  node.append(el('span', 'match__date', match.date));
  participants(match).forEach((bearId, i) => node.append(buildSlot(match, i, bearId)));
  return node;
}

function buildColumn(side, round, matches) {
  const column = el('div', 'column');
  column.dataset.side = side;
  column.dataset.round = String(round);
  column.style.setProperty('--order', String(round * 2 + (side === 'R' ? 1 : 0)));

  const head = el('div', 'col__head');
  const label = ROUND_LABELS[round];
  head.append(
    el('strong', null, label.name),
    el('span', null, side === 'R' ? label.right : label.left)
  );
  column.append(head);

  const body = el('div', 'col__body');
  for (let i = 0; i < matches.length; i += 2) {
    const group = matches.slice(i, i + 2);
    const pair = el('div', 'pair');
    if (group.length === 2) pair.classList.add('pair--join');
    else pair.classList.add('pair--single');
    group.forEach((m) => pair.append(buildMatch(m)));
    body.append(pair);
  }
  column.append(body);
  return column;
}

function buildFinalColumn() {
  const column = el('div', 'column');
  column.dataset.side = 'F';
  column.style.setProperty('--order', '99');

  const head = el('div', 'col__head');
  head.append(el('strong', null, 'Final'), el('span', null, ROUND_LABELS[3].left));
  column.append(head);

  const body = el('div', 'col__body col__body--final');
  const pair = el('div', 'pair pair--single');
  pair.append(buildMatch(FINAL));
  body.append(pair);

  const champId = winnerOf(FINAL.id);
  const plate = el('div', champId ? 'champion' : 'champion champion--empty');
  plate.append(el('p', 'champion__label', `Your ${EVENT.year} champion`));
  plate.append(el('p', 'champion__id', champId ?? '???'));
  plate.append(el('p', 'champion__name', champId ? bearLabel(champId) : 'Pick your way to the crown'));
  body.append(plate);

  column.append(body);
  return column;
}

function renderBoard() {
  const board = $('#bracket');
  board.replaceChildren();
  const pick = (side, round) => MATCHES.filter((m) => m.side === side && m.round === round);

  board.append(
    buildColumn('L', 0, pick('L', 0)),
    buildColumn('L', 1, pick('L', 1)),
    buildColumn('L', 2, pick('L', 2)),
    buildFinalColumn(),
    buildColumn('R', 2, pick('R', 2)),
    buildColumn('R', 1, pick('R', 1)),
    buildColumn('R', 0, pick('R', 0))
  );
}

function renderRoster() {
  const grid = $('#rosterGrid');
  grid.replaceChildren();
  const order = MATCHES.filter((m) => m.slots).flatMap((m) => m.slots);

  for (const id of order) {
    const bear = BEARS[id];
    const card = el('article', 'dossier');
    card.id = `bear-${id}`;

    const photo = el('img', 'dossier__photo');
    photo.src = `/bears/${id}.webp`;
    photo.alt = `Bear ${id}, ${bearLabel(id)}, at Brooks River in September 2026`;
    photo.loading = 'lazy';
    card.append(photo);

    const head = el('div', 'dossier__head');
    head.append(el('span', 'dossier__id', id));
    head.append(el('h3', 'dossier__name', bear.nickname || bear.tagline.split(',')[0]));
    head.append(el('span', 'chip', bear.class));
    card.append(head);

    const vitals = el('p', 'dossier__vitals');
    [bear.sex, bear.age, bear.since].forEach((v) => vitals.append(el('span', null, v)));
    card.append(vitals);

    card.append(el('p', 'dossier__marks', bear.marks));
    card.append(el('p', 'dossier__bio', bear.bio));
    card.append(el('p', 'dossier__edge', bear.edge));
    grid.append(card);
  }
}

/* ── Bear dossier modal ─────────────────────────────────── */

let modalContext = null; // { bearId, matchId } while the dialog is open

function togglePick(matchId, bearId) {
  if (isViewing()) return;
  if (picks[matchId] === bearId) delete picks[matchId];
  else picks[matchId] = bearId;
  refresh();
}

/** Restore focus to the same bear after a re-render blows away the trigger. */
function focusPickButton(matchId, bearId) {
  const btn = document.querySelector(
    `.slot__pick[data-match="${matchId}"][data-bear="${bearId}"]`
  );
  btn?.focus();
}

function openBear(bearId, matchId) {
  const bear = BEARS[bearId];
  if (!bear) return;
  const dialog = $('#bearModal');
  const match = matchId ? MATCH_BY_ID.get(matchId) : null;
  modalContext = { bearId, matchId };

  const photo = $('#modalPhoto');
  const shot = PHOTOS[bearId];
  photo.src = `/bears/${bearId}.webp`;
  photo.alt = `Bear ${bearId}, ${bearLabel(bearId)}, photographed at Brooks River in September 2026`;
  $('#modalCredit').textContent = shot ? `${shot.date} · Courtesy of ${shot.credit} / explore.org` : '';

  // A nicknamed bear reads "32 Chunk"; an unnamed one is just "Bear 901",
  // so the big number would only repeat itself.
  $('#modalId').textContent = bearId;
  $('#modalId').hidden = !bear.nickname;
  $('#modalName').textContent = bearLabel(bearId);
  $('#modalTagline').textContent = bear.tagline;
  $('#modalMarks').textContent = bear.marks;
  $('#modalBio').textContent = bear.bio;
  $('#modalEdge').textContent = bear.edge;

  const vitals = $('#modalVitals');
  vitals.replaceChildren();
  for (const [term, value] of [
    ['Class', bear.class],
    ['Sex', bear.sex],
    ['Age', bear.age],
    ['On record', bear.since],
  ]) {
    const pair = el('div');
    pair.append(el('dt', null, term), el('dd', null, value));
    vitals.append(pair);
  }

  const matchup = $('#modalMatchup');
  const advance = $('#modalAdvance');
  if (match) {
    const others = participants(match).filter((b) => b !== bearId);
    const rival = others[0];
    const rivalIndex = participants(match).indexOf(null);
    const facing = rival
      ? `${bearLabel(rival)} (${rival})`
      : `the winner of ${feederNames(match, rivalIndex < 0 ? 0 : rivalIndex)}`;
    matchup.replaceChildren(
      document.createTextNode(`${ROUND_LABELS[match.round].name} · ${match.date} — facing `),
      el('strong', null, facing)
    );
    matchup.hidden = false;

    const picked = picks[match.id] === bearId;
    advance.textContent = picked
      ? 'Undo this pick'
      : match.id === FINAL.id
        ? `Crown ${bearLabel(bearId)}`
        : `Advance ${bearLabel(bearId)}`;
    advance.hidden = false;
  } else {
    matchup.hidden = true;
    advance.hidden = true;
  }

  dialog.showModal();
  if (!advance.hidden) advance.focus();
}

function initModal() {
  const dialog = $('#bearModal');

  $('#modalAdvance').addEventListener('click', () => {
    if (!modalContext?.matchId) return;
    const { matchId, bearId } = modalContext;
    togglePick(matchId, bearId);
    dialog.close();
    focusPickButton(matchId, bearId);
  });

  // Clicking the dimmed area outside the panel closes it.
  dialog.addEventListener('click', (ev) => {
    if (ev.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const outside =
      ev.clientX < box.left ||
      ev.clientX > box.right ||
      ev.clientY < box.top ||
      ev.clientY > box.bottom;
    if (outside) dialog.close();
  });

  closeOnBackdrop(dialog);

  dialog.addEventListener('close', () => {
    modalContext = null;
  });
}

/** Clicking the dimmed area outside a dialog's panel closes it. */
function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (ev) => {
    if (ev.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const outside =
      ev.clientX < box.left ||
      ev.clientX > box.right ||
      ev.clientY < box.top ||
      ev.clientY > box.bottom;
    if (outside) dialog.close();
  });
}

/* ── Accounts ───────────────────────────────────────────── */

const AUTH_BLURB = 'Signing in ties the bracket to you, so nobody else can edit your picks.';

function setAuthMessage(text, tone) {
  const node = $('#authMessage');
  node.textContent = text;
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function renderAuth() {
  const bar = $('#trayAuth');
  if (!store.needsAuth) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.replaceChildren();

  if (account) {
    bar.append(el('span', 'tray__who', account.email));
    const out = el('button', 'btn btn--quiet', 'Sign out');
    out.type = 'button';
    out.addEventListener('click', async () => {
      await store.signOut();
      setStatus('Signed out. Your picks stay on this device.');
    });
    bar.append(out);
  } else {
    const button = el('button', 'btn', 'Sign in');
    button.type = 'button';
    button.addEventListener('click', () => openAuth());
    bar.append(button);
  }
}

function openAuth(message) {
  setAuthMessage(message ?? AUTH_BLURB);
  $('#authModal').showModal();
  $('#authEmail').focus();
}

function initAuth() {
  const dialog = $('#authModal');
  let authReady = false;

  for (const btn of dialog.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => dialog.close());
  }
  closeOnBackdrop(dialog);

  $('#authForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('#authEmail').value.trim();
    const button = $('#authSubmit');
    button.disabled = true;
    setAuthMessage('Sending…');
    try {
      await store.signIn(email);
      setAuthMessage(`Link sent to ${email}. Open it on this device and you are in.`, 'ok');
    } catch (err) {
      setAuthMessage(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  store.onAuthChange((user) => {
    const signedIn = Boolean(user) && !account;
    account = user;
    renderAuth();

    if (user) {
      dialog.close();
      if (!$('#entryName').value.trim()) {
        entryName = user.email.split('@')[0];
        $('#entryName').value = entryName;
        persist();
      }
      if (signedIn && authReady) {
        setStatus(`Signed in as ${user.email}.`);
        if (isComplete()) submitBracket();
      }
    }
    if (authReady) loadPool();
    authReady = true;
  });
}

function updateTray() {
  const count = pickCount();
  const champ = winnerOf(FINAL.id);
  $('#trayCount').textContent = `${count} of ${MATCHES.length}`;
  $('#factPicks').textContent = String(count);
  $('#meterFill').style.width = `${(count / MATCHES.length) * 100}%`;
  $('#trayChamp').textContent = champ ? `${bearLabel(champ)} (${champ}) takes it` : 'no champion yet';
  $('#submitBtn').disabled = !isComplete();
}

function setStatus(message, tone) {
  const node = $('#trayStatus');
  node.textContent = message;
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function refresh() {
  if (!isViewing()) prune();
  renderBoard();
  updateTray();
  persist();
}

/* ── Persistence ────────────────────────────────────────── */

function persist() {
  // Viewing someone else must never overwrite what you saved.
  if (isViewing()) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ code: encodePicks(), name: entryName, entryId })
    );
  } catch {
    // private browsing — picks just won't survive a reload
  }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!saved) return false;
    decodePicks(saved.code);
    entryName = saved.name ?? '';
    entryId = saved.entryId ?? null;
    return true;
  } catch {
    return false;
  }
}

/* ── The pool ───────────────────────────────────────────── */

/** Run fn with a different picks object in scope, then put yours back. */
function withPicks(temp, fn) {
  const saved = picks;
  picks = temp;
  try {
    return fn();
  } finally {
    picks = saved;
  }
}

/** Turn a stored 0/1-per-matchup bracket into a picks object. */
function picksFromIndices(indices) {
  const out = {};
  withPicks(out, () => {
    MATCHES.forEach((match, i) => {
      const idx = indices?.[i];
      if (idx !== 0 && idx !== 1) return;
      const bear = participants(match)[idx];
      if (bear) out[match.id] = bear;
    });
  });
  return out;
}

function championOf(indices) {
  const resolved = picksFromIndices(indices);
  return withPicks(resolved, () => winnerOf(FINAL.id));
}

/* ── Viewing someone else's bracket ─────────────────────── */

function enterViewing(entry) {
  if (!isViewing()) myPicks = picks;
  viewing = { id: entry.id, name: entry.name };
  picks = picksFromIndices(entry.picks);

  setView('bracket', { push: false });
  $('#guestName').textContent = `${entry.name} · ${entry.id}`;
  $('#guestBanner').hidden = false;
  $('#boardNote').textContent =
    'Read-only. Tap any bear to read their dossier; nothing here changes your own picks.';
  document.body.dataset.view = 'guest';
  history.replaceState(null, '', `/b/${entry.id}`);
  renderBoard();
  updateTray();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function exitViewing() {
  if (!isViewing()) return;
  viewing = null;
  picks = myPicks ?? {};
  myPicks = null;
  $('#guestBanner').hidden = true;
  $('#boardNote').textContent =
    'Tap a bear to read their dossier, or use the ✓ to advance them straight away. Changing an earlier pick clears everything it fed into.';
  delete document.body.dataset.view;
  history.replaceState(null, '', '/');
  refresh();
  setStatus('Back on your own bracket.');
}

/* ── Switching between the two views ────────────────────── */

function setView(next, { push = true } = {}) {
  view = next === 'pool' ? 'pool' : 'bracket';
  $('#viewBracket').hidden = view !== 'bracket';
  $('#roster').hidden = view !== 'bracket';
  $('#viewPool').hidden = view !== 'pool';
  $('.tray').hidden = view !== 'bracket' || isViewing();

  for (const tab of document.querySelectorAll('.viewnav__tab')) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('viewnav__tab--active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }

  if (push) history.replaceState(null, '', view === 'pool' ? '/pool' : '/');
  if (view === 'pool') {
    window.scrollTo({ top: 0, behavior: 'auto' });
    loadPool();
  }
}

/* ── The pool page ──────────────────────────────────────── */

function renderTally(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const champ = championOf(entry.picks);
    if (champ) counts.set(champ, (counts.get(champ) ?? 0) + 1);
  }

  const tally = $('#tally');
  const list = $('#tallyList');
  list.replaceChildren();
  if (!counts.size) {
    tally.hidden = true;
    return;
  }
  tally.hidden = false;

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const leader = ranked[0][1];

  for (const [bearId, count] of ranked) {
    const row = el('li', 'tally__row');

    const face = el('img', 'tally__face');
    face.src = `/bears/${bearId}-sm.webp`;
    face.alt = '';
    face.loading = 'lazy';
    face.width = 40;
    face.height = 40;

    const label = el('div', 'tally__label');
    label.append(el('span', 'tally__num', bearId), el('span', 'tally__name', bearLabel(bearId)));

    const bar = el('div', 'tally__bar');
    const fill = el('span', 'tally__fill');
    fill.style.width = `${(count / leader) * 100}%`;
    bar.append(fill);

    const share = Math.round((count / entries.length) * 100);
    row.append(face, label, bar, el('span', 'tally__count', `${count} · ${share}%`));
    list.append(row);
  }
}

function buildEntryCard(entry) {
  const champ = championOf(entry.picks);
  const mine = entry.mine || entry.id === entryId;
  const card = el('button', mine ? 'entry entry--mine' : 'entry');
  card.type = 'button';

  if (champ) {
    const face = el('img', 'entry__face');
    face.src = `/bears/${champ}-sm.webp`;
    face.alt = '';
    face.loading = 'lazy';
    face.width = 44;
    face.height = 44;
    card.append(face);
  }

  const body = el('div', 'entry__body');
  const nameRow = el('div', 'entry__nameRow');
  nameRow.append(el('span', 'entry__name', entry.name));
  if (mine) nameRow.append(el('span', 'entry__badge', 'yours'));
  body.append(nameRow);
  body.append(
    el('span', 'entry__pick', champ ? `${bearLabel(champ)} to win · ${champ}` : 'incomplete')
  );
  body.append(el('span', 'entry__code', entry.id));
  card.append(body);

  card.title = `Open ${entry.name}'s bracket, read-only`;
  card.addEventListener('click', () => enterViewing(entry));
  return card;
}

async function loadPool() {
  const body = $('#poolBody');
  try {
    const entries = await store.listEntries();
    $('#navCount').textContent = entries.length ? String(entries.length) : '';
    $('#poolSubtitle').textContent =
      entries.length === 1 ? '1 bracket' : `${entries.length} brackets`;

    renderTally(entries);
    body.replaceChildren();
    if (!entries.length) {
      body.append(el('p', 'pool__empty', 'No brackets in yet. Be the first.'));
      return;
    }
    for (const entry of entries) body.append(buildEntryCard(entry));
  } catch (err) {
    $('#tally').hidden = true;
    body.replaceChildren(
      el(
        'p',
        'pool__error',
        `Could not reach the pool right now (${err.message}). Your own picks are still saved.`
      )
    );
  }
}

async function submitBracket() {
  if (store.needsAuth && !account) {
    openAuth('Sign in and your bracket gets submitted straight after.');
    return;
  }
  const name = $('#entryName').value.trim();
  if (!name) {
    setStatus('Add your name so the pool knows whose bracket this is.', 'error');
    $('#entryName').focus();
    return;
  }
  entryName = name;
  $('#submitBtn').disabled = true;
  setStatus('Submitting…');
  try {
    const entry = await store.saveEntry({ name, picks: picksAsIndices(), id: entryId });
    entryId = entry.id;
    store.adopt?.(entry.id);
    persist();
    history.replaceState(null, '', `/b/${entryId}`);
    setStatus(`Locked in as ${entryId}. The link in your address bar loads this bracket.`);
    loadPool();
  } catch (err) {
    setStatus(err.message ?? 'Submission failed.', 'error');
  } finally {
    $('#submitBtn').disabled = !isComplete();
  }
}

async function copyLink() {
  const url = entryId
    ? `${location.origin}/b/${entryId}`
    : `${location.origin}/?p=${encodePicks()}`;
  try {
    await navigator.clipboard.writeText(url);
    setStatus(`Copied: ${url}`);
  } catch {
    setStatus(url);
  }
}

/* ── Theme ──────────────────────────────────────────────── */

const THEMES = ['auto', 'light', 'dark'];

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('#themeLabel').textContent = theme[0].toUpperCase() + theme.slice(1);
  try {
    localStorage.setItem('svidbear.theme', theme);
  } catch {
    // ignore
  }
}

/* ── Wiring ─────────────────────────────────────────────── */

async function init() {
  $('#votingNote').textContent = EVENT.votingNote;
  store = await createStore();

  const params = new URLSearchParams(location.search);
  const shared = params.get('p');
  const pathCode = location.pathname.match(/^\/b\/([A-Za-z0-9]+)/)?.[1];

  if (shared) {
    decodePicks(shared);
    if (params.get('n')) entryName = params.get('n');
  } else {
    restore();
  }

  renderRoster();
  refresh();
  $('#entryName').value = entryName;

  let theme = 'auto';
  try {
    theme = localStorage.getItem('svidbear.theme') ?? 'auto';
  } catch {
    // ignore
  }
  applyTheme(THEMES.includes(theme) ? theme : 'auto');

  initModal();

  $('#bracket').addEventListener('click', (ev) => {
    const pickBtn = ev.target.closest('.slot__pick');
    if (pickBtn) {
      const { match, bear } = pickBtn.dataset;
      togglePick(match, bear);
      focusPickButton(match, bear);
      return;
    }
    const main = ev.target.closest('.slot__main');
    if (main?.dataset.bear) openBear(main.dataset.bear, main.dataset.match);
  });

  $('#submitBtn').addEventListener('click', submitBracket);
  $('#shareBtn').addEventListener('click', copyLink);
  $('#resetBtn').addEventListener('click', () => {
    if (isViewing()) return exitViewing();
    picks = {};
    entryId = null;
    history.replaceState(null, '', '/');
    refresh();
    setStatus('Bracket cleared.');
  });
  $('#entryName').addEventListener('input', (ev) => {
    entryName = ev.target.value;
    persist();
  });
  $('#themeToggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme ?? 'auto';
    applyTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
  });

  $('#guestExit').addEventListener('click', exitViewing);

  for (const tab of document.querySelectorAll('.viewnav__tab')) {
    tab.addEventListener('click', (ev) => {
      ev.preventDefault();
      // Leaving a guest bracket by either tab puts your own picks back first.
      if (isViewing()) exitViewing();
      setView(tab.dataset.view);
    });
  }

  initAuth();
  setView(location.pathname === '/pool' ? 'pool' : 'bracket', { push: false });
  loadPool();

  if (pathCode) {
    store
      .getEntry(pathCode)
      .then((entry) => {
        if (!entry) throw new Error(`No bracket with the code ${pathCode}.`);
        enterViewing(entry);
      })
      .catch((err) => setStatus(err.message, 'error'));
  }
}

init();
