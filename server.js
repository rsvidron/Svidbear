import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile();
} catch {
  // no .env file — Railway injects real environment variables instead
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE = path.join(DATA_DIR, 'entries.json');
const MATCH_COUNT = 15;

// Both spellings work, so the keys Supabase hands you paste in unchanged.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

fs.mkdirSync(DATA_DIR, { recursive: true });

/** @type {Map<string, object>} */
const entries = new Map();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    for (const e of raw) entries.set(e.id, e);
    console.log(`loaded ${entries.size} entries`);
  } catch {
    // no store yet — first boot
  }
}

let writeQueued = false;
function save() {
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    const tmp = `${STORE}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify([...entries.values()]));
      fs.renameSync(tmp, STORE);
    } catch (err) {
      console.error('save failed:', err.message);
    }
  }, 250);
}

function newId() {
  // 6 chars, no vowels or lookalikes — readable out loud
  const alphabet = '23456789BCDFGHJKLMNPQRSTVWXZ';
  let id = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

function cleanPicks(input) {
  if (!Array.isArray(input) || input.length !== MATCH_COUNT) return null;
  return input.map((v) => (v === 0 || v === 1 ? v : null));
}

load();

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '8kb' }));

const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_KEY);

app.get('/healthz', (_req, res) =>
  res.json({ ok: true, backend: supabaseReady ? 'supabase' : 'local', entries: entries.size })
);

// The publishable key is meant to reach the browser; row-level security is what protects the data.
app.get('/api/config', (_req, res) =>
  res.json(supabaseReady ? { supabase: { url: SUPABASE_URL, key: SUPABASE_KEY } } : { supabase: null })
);

// Everyone's entries, newest first. Picks included so the pool view can compare.
app.get('/api/entries', (_req, res) => {
  const list = [...entries.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
  res.json({ entries: list });
});

app.get('/api/entries/:id', (req, res) => {
  const entry = entries.get(req.params.id.toUpperCase());
  if (!entry) return res.status(404).json({ error: 'No entry with that code.' });
  res.json({ entry });
});

app.post('/api/entries', (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 40);
  const picks = cleanPicks(req.body?.picks);
  if (!name) return res.status(400).json({ error: 'Add a name so people know whose bracket this is.' });
  if (!picks) return res.status(400).json({ error: 'That bracket is malformed. Refresh and try again.' });
  if (picks.some((p) => p === null)) return res.status(400).json({ error: 'Fill in every matchup before submitting.' });

  const existingId = typeof req.body?.id === 'string' ? req.body.id.toUpperCase() : null;
  const id = existingId && entries.has(existingId) ? existingId : newId();
  const prior = entries.get(id);
  const entry = { id, name, picks, createdAt: prior?.createdAt ?? Date.now(), updatedAt: Date.now() };
  entries.set(id, entry);
  save();
  res.status(prior ? 200 : 201).json({ entry });
});

// There is no bundler, so the browser gets supabase-js served straight out of
// node_modules. Serving beats copying it into public/: nothing has to be written
// at boot, so a read-only or slow filesystem cannot quietly drop the app back to
// the local store.
app.get('/vendor/supabase.js', (_req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), {
    maxAge: '1h',
  })
);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Entry permalinks render the app; the client reads the code off the path.
app.get('/b/:id', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((_req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () =>
  console.log(
    `Svidbear listening on :${PORT} — brackets stored in ${
      supabaseReady ? 'Supabase' : 'a local JSON file (set SUPABASE_URL and SUPABASE_ANON_KEY)'
    }`
  )
);
