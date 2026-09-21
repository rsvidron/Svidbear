# Svidbear — Fat Bear Week 2026 Bracket

A fill-out-and-share bracket for Fat Bear Week 2026 at Katmai National Park & Preserve. Sixteen
bears, four rounds, one crown. Pick every matchup, read each contender's dossier, submit your
bracket, and compare it against everyone else's.

No build step, no database, one dependency.

## Running it

```bash
npm install && npm start
```

Then open http://localhost:3000.

## How it works

- `public/data.js` — the 16 bears and the 15 matchups. This is the only file to edit when the
  bracket or the bear details change.
- `public/app.js` — bracket state, pick cascade, sharing, the pool. Vanilla ES modules, no bundler.
- `public/styles.css` — full light/dark token system; the bracket connectors are pure CSS.
- `server.js` — Express. Serves `public/` and a small JSON API for submitted brackets.

Tapping a bear opens their dossier in a modal with an "Advance" button; the check circle on the
right of each row advances them in one click. Picks are stored by bear, not by slot position, so changing an early matchup automatically clears
every later pick that depended on it.

### Sharing

| What | Link |
| --- | --- |
| A submitted bracket | `/b/CODE` — six-character code, loads that person's picks |
| An unsubmitted bracket | `/?p=011010…` — one character per matchup, no server round-trip |

Picks also persist in `localStorage`, so a refresh never loses work.

### API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Health check (Railway uses this) |
| `GET` | `/api/entries` | Every submitted bracket, newest first |
| `GET` | `/api/entries/:id` | One bracket by its code |
| `POST` | `/api/entries` | Submit or update a bracket (`{ name, picks, id? }`) |

`picks` is an array of 15 values, each `0` or `1` — which slot of that matchup won.

## Deploying to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, pick this repo.
3. Railway's Nixpacks builder detects Node and runs `npm start`. `railway.json` already sets the
   start command and points the healthcheck at `/healthz`.
4. Under **Settings → Networking**, click **Generate Domain**.

Railway injects `PORT` automatically — the server reads it and falls back to 3000 locally.

### Keeping submitted brackets across deploys

Entries are written to `data/entries.json`. Railway containers have ephemeral filesystems, so
without a volume that file is wiped on every redeploy. To keep the pool:

1. Railway → your service → **Variables** → add `DATA_DIR=/data`.
2. **Settings → Volumes** → **Add Volume**, mount path `/data`.

Entries are also held in memory, so the app works fine without a volume — you just start the pool
over each time you deploy.

## Sources

Bear identifications, life histories, and the 2026 bracket come from
[explore.org](https://explore.org/fat-bear-week) and the
[National Park Service](https://www.nps.gov/katm/learn/news/fat-bear-week-2026.htm). This is an
unofficial pool — official votes are cast at [fatbearweek.org](https://fatbearweek.org).
