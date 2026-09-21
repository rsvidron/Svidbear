import { BEARS, MATCHES, ROUND_LABELS, EVENT } from '/data.js';

const MATCH_BY_ID = new Map(MATCHES.map((m) => [m.id, m]));
const FINAL = MATCHES[MATCHES.length - 1];
const STORAGE_KEY = 'svidbear.bracket.v1';

/** matchId -> bear id of the bear the user advanced */
let picks = {};
let entryId = null;
let entryName = '';

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
    main.append(el('span', 'slot__id', '—'));
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
  main.append(el('span', 'slot__id', bearId));
  const body = el('div', 'slot__body');
  body.append(el('span', 'slot__name', bearLabel(bearId)), el('span', 'slot__meta', bear.class));
  main.append(body);

  const pick = el('button', 'slot__pick');
  pick.type = 'button';
  pick.dataset.match = match.id;
  pick.dataset.bear = bearId;
  pick.setAttribute('aria-pressed', String(picked));
  pick.setAttribute(
    'aria-label',
    picked ? `Undo advancing bear ${bearId}` : `Advance bear ${bearId} to the next round`
  );
  pick.append(el('span', 'slot__check', '✓'));

  row.append(main, pick);
  return row;
}

function buildMatch(match) {
  const node = el('div', 'match');
  node.dataset.match = match.id;
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

  $('#modalId').textContent = bearId;
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

  dialog.addEventListener('close', () => {
    modalContext = null;
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
  prune();
  renderBoard();
  updateTray();
  persist();
}

/* ── Persistence ────────────────────────────────────────── */

function persist() {
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

function bearFromIndices(indices, matchId) {
  // Resolve another person's index-encoded bracket without touching our own picks.
  const saved = picks;
  picks = {};
  MATCHES.forEach((match, i) => {
    const idx = indices[i];
    if (idx !== 0 && idx !== 1) return;
    const bear = participants(match)[idx];
    if (bear) picks[match.id] = bear;
  });
  const result = winnerOf(matchId);
  picks = saved;
  return result;
}

async function loadPool() {
  const body = $('#poolBody');
  try {
    const res = await fetch('/api/entries');
    if (!res.ok) throw new Error('bad response');
    const { entries } = await res.json();
    body.replaceChildren();
    if (!entries.length) {
      body.append(el('p', 'pool__empty', 'No brackets in yet. Be the first.'));
      return;
    }
    for (const entry of entries) {
      const champ = bearFromIndices(entry.picks, FINAL.id);
      const card = el('button', entry.id === entryId ? 'entry entry--mine' : 'entry');
      card.type = 'button';
      card.append(el('span', 'entry__name', entry.name));
      card.append(
        el('span', 'entry__pick', champ ? `${bearLabel(champ)} · ${champ}` : 'incomplete')
      );
      card.append(el('span', 'entry__code', entry.id));
      card.title = 'Load this bracket';
      card.addEventListener('click', () => {
        decodePicksFromIndices(entry.picks);
        entryName = entry.name;
        entryId = entry.id;
        $('#entryName').value = entry.name;
        refresh();
        setStatus(`Loaded ${entry.name}'s bracket (${entry.id}).`);
        loadPool();
        $('#board').scrollIntoView({ block: 'start' });
      });
      body.append(card);
    }
  } catch {
    body.replaceChildren(
      el('p', 'pool__error', 'Could not reach the pool right now. Your own picks are still saved.')
    );
  }
}

function decodePicksFromIndices(indices) {
  picks = {};
  MATCHES.forEach((match, i) => {
    const idx = indices[i];
    if (idx !== 0 && idx !== 1) return;
    const bear = participants(match)[idx];
    if (bear) picks[match.id] = bear;
  });
}

async function submitBracket() {
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
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, picks: picksAsIndices(), id: entryId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Submission failed.');
    entryId = data.entry.id;
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

function init() {
  $('#votingNote').textContent = EVENT.votingNote;

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

  loadPool();

  if (pathCode) {
    fetch(`/api/entries/${pathCode}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Bracket not found.'))))
      .then(({ entry }) => {
        decodePicksFromIndices(entry.picks);
        entryName = entry.name;
        entryId = entry.id;
        $('#entryName').value = entry.name;
        refresh();
        setStatus(`Showing ${entry.name}'s bracket (${entry.id}).`);
        loadPool();
      })
      .catch((err) => setStatus(err.message, 'error'));
  }
}

init();
