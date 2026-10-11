// Drop-in replacement for the Claude-artifact `window.storage` API.
// Same shape: get/set/delete return { key, value, shared } | null, all async.
//
// When the app runs as a published claude.ai artifact, entries are saved to
// the artifact's database, in the viewer's own private subtree, so they follow
// the viewer across devices. Everywhere else (local dev, a static host) it
// falls back to the browser's localStorage.

const PREFIX = "fitness-tracker:";

// Resolves to the viewer's private db collection, or null when not available.
const cloud = (async () => {
  try {
    if (!window.claude?.use) return null;
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    if (!db || !user) return null;
    const id = await user.id();
    if (!id) return null;
    return db.collection("data/users/" + id);
  } catch (err) {
    return null;
  }
})();

// Document ids can't contain some characters; month keys look like "month:2026-09".
const docId = (key) => key.replace(/[^A-Za-z0-9_\-.~:@+]/g, "_");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Keys whose last cloud read failed. Saving one would overwrite entries we
// never loaded, so set() refuses until a read of that key succeeds.
const unread = new Set();

const local = {
  get(key) {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      return raw === null ? null : raw;
    } catch (err) {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(PREFIX + key, value);
      return true;
    } catch (err) {
      return false;
    }
  },
  delete(key) {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch (err) {
      /* ignore */
    }
  },
};

export const storage = {
  async get(key, shared = false) {
    const col = await cloud;
    if (col) {
      let snap;
      try {
        snap = await col.doc(docId(key)).get();
      } catch (err) {
        await sleep(400 + Math.random() * 600);
        try {
          snap = await col.doc(docId(key)).get();
        } catch (err2) {
          unread.add(key);
          throw err2;
        }
      }
      unread.delete(key);
      if (!snap.exists) return null;
      return { key, value: snap.data().value, shared };
    }
    const raw = local.get(key);
    return raw === null ? null : { key, value: raw, shared };
  },

  async set(key, value, shared = false) {
    const col = await cloud;
    if (col) {
      if (unread.has(key)) return null;
      try {
        await col.doc(docId(key)).set({ value, updatedAt: new Date().toISOString() });
        return { key, value, shared };
      } catch (err) {
        console.error("storage.set failed:", err);
        return null;
      }
    }
    // e.g. storage full or unavailable (private browsing in some browsers)
    if (!local.set(key, value)) {
      console.error("storage.set failed");
      return null;
    }
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    const col = await cloud;
    try {
      if (col) await col.doc(docId(key)).delete();
      else local.delete(key);
      return { key, deleted: true, shared };
    } catch (err) {
      return null;
    }
  },

  async list(prefix = "", shared = false) {
    const col = await cloud;
    try {
      if (col) {
        const snap = await col.get();
        const keys = snap.docs.map((d) => d.id).filter((k) => k.startsWith(prefix));
        return { keys, prefix, shared };
      }
      const keys = [];
      const full = PREFIX + prefix;
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(full)) keys.push(k.slice(PREFIX.length));
      }
      return { keys, prefix, shared };
    } catch (err) {
      return null;
    }
  },
};
