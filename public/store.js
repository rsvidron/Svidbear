/**
 * Where brackets live.
 *
 * Two interchangeable backends behind one interface:
 *   supabase — Postgres + magic-link auth, row-level security, survives redeploys
 *   local    — the Express JSON store, used when no Supabase keys are configured
 *
 * The app only ever talks to the interface, so running without Supabase keys
 * still gives you a working pool.
 */

const TABLE = 'brackets';
const SELECT = 'code,name,picks,user_id,updated_at';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(tag);
  });
}

export async function createStore() {
  let config = { supabase: null };
  try {
    config = await fetch('/api/config').then((res) => res.json());
  } catch {
    // fall through to the local store
  }
  if (!config.supabase) return localStore();
  try {
    return await supabaseStore(config.supabase);
  } catch (err) {
    console.warn('Supabase unavailable, falling back to the local store:', err.message);
    return localStore();
  }
}

/* ── Supabase ───────────────────────────────────────────── */

async function supabaseStore({ url, key }) {
  if (!window.supabase) await loadScript('/vendor/supabase.js');
  const sb = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // Resolves once the magic-link code in the URL (if any) has been exchanged.
  const { data: initial } = await sb.auth.getSession();
  let user = initial.session?.user ?? null;
  const listeners = new Set();

  sb.auth.onAuthStateChange((_event, session) => {
    user = session?.user ?? null;
    for (const fn of listeners) fn(currentUser());
  });

  function currentUser() {
    return user ? { id: user.id, email: user.email } : null;
  }

  function shape(row) {
    return {
      id: row.code,
      name: row.name,
      picks: row.picks,
      mine: Boolean(user && row.user_id === user.id),
    };
  }

  function fail(error, fallback) {
    // Turn Postgres and PostgREST codes into something worth reading.
    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      return new Error('The brackets table is missing — run supabase/schema.sql in the SQL editor.');
    }
    if (error?.code === '23514') return new Error('That bracket is incomplete or malformed.');
    if (error?.code === '42501') return new Error('Sign in again — that write was not permitted.');
    return new Error(error?.message ?? fallback);
  }

  return {
    mode: 'supabase',
    needsAuth: true,
    currentUser,
    onAuthChange(fn) {
      listeners.add(fn);
      fn(currentUser());
    },

    async signIn(email) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin },
      });
      if (error) throw fail(error, 'Could not send the sign-in link.');
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async listEntries() {
      const { data, error } = await sb
        .from(TABLE)
        .select(SELECT)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw fail(error, 'Could not load the pool.');
      return data.map(shape);
    },

    async getEntry(code) {
      const { data, error } = await sb.from(TABLE).select(SELECT).eq('code', code).maybeSingle();
      if (error) throw fail(error, 'Could not load that bracket.');
      return data ? shape(data) : null;
    },

    async saveEntry({ name, picks }) {
      if (!user) throw new Error('Sign in first so the bracket is tied to you.');
      const { data, error } = await sb
        .from(TABLE)
        .upsert({ user_id: user.id, name, picks }, { onConflict: 'user_id' })
        .select(SELECT)
        .single();
      if (error) throw fail(error, 'Could not save your bracket.');
      return shape(data);
    },
  };
}

/* ── Local Express store ────────────────────────────────── */

function localStore() {
  let myId = null;

  async function call(path, options) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
    return data;
  }

  const shape = (entry) => ({ ...entry, mine: entry.id === myId });

  return {
    mode: 'local',
    needsAuth: false,
    currentUser: () => null,
    onAuthChange(fn) {
      fn(null);
    },
    async signIn() {
      throw new Error('Sign-in needs Supabase keys. Running without them for now.');
    },
    async signOut() {},

    async listEntries() {
      const { entries } = await call('/api/entries');
      return entries.map(shape);
    },

    async getEntry(code) {
      try {
        const { entry } = await call(`/api/entries/${code}`);
        return shape(entry);
      } catch {
        return null;
      }
    },

    async saveEntry({ name, picks, id }) {
      const { entry } = await call('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, picks, id: id ?? myId }),
      });
      myId = entry.id;
      return shape(entry);
    },

    adopt(id) {
      myId = id;
    },
  };
}
