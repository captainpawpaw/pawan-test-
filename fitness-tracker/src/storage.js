// Drop-in replacement for the Claude-artifact `window.storage` API, backed by
// the browser's localStorage so the app works as a standalone deployed site.
// Same shape: get/set/delete return { key, value, shared } | null, all async.

const PREFIX = "fitness-tracker:";

export const storage = {
  async get(key, shared = false) {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw === null) return null;
      return { key, value: raw, shared };
    } catch (err) {
      throw err;
    }
  },

  async set(key, value, shared = false) {
    try {
      window.localStorage.setItem(PREFIX + key, value);
      return { key, value, shared };
    } catch (err) {
      // e.g. storage full or unavailable (private browsing in some browsers)
      console.error("storage.set failed:", err);
      return null;
    }
  },

  async delete(key, shared = false) {
    try {
      window.localStorage.removeItem(PREFIX + key);
      return { key, deleted: true, shared };
    } catch (err) {
      return null;
    }
  },

  async list(prefix = "", shared = false) {
    try {
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
