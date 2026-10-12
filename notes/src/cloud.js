// Cloud storage for when the app runs as a published claude.ai artifact.
// Each viewer's notes live in their own private `data/users/<id>` collection,
// one document per note. Outside claude.ai this resolves null and the app
// falls back to localStorage.

const TYPING_PAUSE_MS = 700;

export async function connectCloud() {
  if (!window.claude?.use) return null;
  const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
  if (!db || !user) return null;
  const uid = await user.id();
  if (!uid) return null;
  return createSync(db.collection("data/users/" + uid));
}

function createSync(col) {
  const chains = new Map(); // id -> promise; one write at a time per document
  const timers = new Map(); // id -> pending typing-pause timeout
  const latest = new Map(); // id -> note waiting to be written
  let onError = () => {};

  function enqueue(id, fn) {
    const p = (chains.get(id) || Promise.resolve())
      .then(fn)
      .catch((e) => onError(e))
      .finally(() => { if (chains.get(id) === p) chains.delete(id); });
    chains.set(id, p);
    return p;
  }

  const body = (n) => ({ body: n.body, pinned: n.pinned, createdAt: n.createdAt, updatedAt: n.updatedAt });

  function flush(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const note = latest.get(id);
    if (!note) return;
    latest.delete(id);
    enqueue(id, () => col.doc(id).set(body(note)));
  }

  return {
    set onError(fn) { onError = fn; },

    subscribe(next, error) {
      return col.onSnapshot(
        (snap) => next(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        error,
      );
    },

    // Notes with an edit not yet written; their local copy wins over snapshots.
    isDirty: (id) => latest.has(id),

    // Typing: one write per pause.
    saveSoon(note) {
      latest.set(note.id, note);
      clearTimeout(timers.get(note.id));
      timers.set(note.id, setTimeout(() => flush(note.id), TYPING_PAUSE_MS));
    },

    save(note) {
      latest.set(note.id, note);
      flush(note.id);
    },

    remove(id) {
      clearTimeout(timers.get(id));
      timers.delete(id);
      latest.delete(id);
      enqueue(id, () => col.doc(id).delete());
    },

    flushAll() {
      for (const id of [...latest.keys()]) flush(id);
    },
  };
}

// Merge a snapshot with local state, keeping local copies of notes still being edited.
export function applySnapshot(local, remote, isDirty) {
  const localById = new Map(local.map((n) => [n.id, n]));
  const remoteIds = new Set(remote.map((n) => n.id));
  const merged = remote.map((r) => (isDirty(r.id) && localById.has(r.id) ? localById.get(r.id) : r));
  for (const n of local) if (!remoteIds.has(n.id) && isDirty(n.id)) merged.push(n);
  return merged;
}
