// Pure note helpers — no DOM or storage access, so they run under node --test.

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createNote(now = Date.now()) {
  return { id: newId(), body: "", pinned: false, createdAt: now, updatedAt: now };
}

// The title is the first non-empty line, with leading markdown heading marks stripped.
export function titleOf(note) {
  const line = note.body.split("\n").find((l) => l.trim() !== "");
  return line ? line.replace(/^#+\s*/, "").trim() || "Untitled" : "Untitled";
}

// Preview is the text after the title line, collapsed to one line.
export function previewOf(note, max = 80) {
  const lines = note.body.split("\n");
  const titleIdx = lines.findIndex((l) => l.trim() !== "");
  const rest = lines.slice(titleIdx + 1).join(" ").replace(/\s+/g, " ").trim();
  return rest.length > max ? rest.slice(0, max - 1) + "…" : rest;
}

export function tagsOf(note) {
  const tags = new Set();
  for (const m of note.body.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) tags.add(m[2].toLowerCase());
  return [...tags].sort();
}

// Pinned first, then most recently edited.
export function sortNotes(notes) {
  return [...notes].sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
}

// Every whitespace-separated term must appear (case-insensitive). "#tag" terms match tags exactly.
export function filterNotes(notes, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return notes;
  return notes.filter((n) => {
    const body = n.body.toLowerCase();
    const tags = tagsOf(n);
    return terms.every((t) =>
      t.startsWith("#") && t.length > 1 ? tags.includes(t.slice(1)) : body.includes(t)
    );
  });
}

export function allTags(notes) {
  const counts = new Map();
  for (const n of notes) for (const t of tagsOf(n)) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
}

// Accepts a parsed backup and returns only well-formed notes.
export function validateImport(data) {
  const list = Array.isArray(data) ? data : data && Array.isArray(data.notes) ? data.notes : null;
  if (!list) throw new Error("Not a notes backup file");
  return list
    .filter((n) => n && typeof n.id === "string" && typeof n.body === "string")
    .map((n) => ({
      id: n.id,
      body: n.body,
      pinned: !!n.pinned,
      createdAt: Number(n.createdAt) || Date.now(),
      updatedAt: Number(n.updatedAt) || Date.now(),
    }));
}

// Imported notes replace local ones with the same id only if they are newer.
export function mergeNotes(local, incoming) {
  const byId = new Map(local.map((n) => [n.id, n]));
  for (const n of incoming) {
    const cur = byId.get(n.id);
    if (!cur || n.updatedAt > cur.updatedAt) byId.set(n.id, n);
  }
  return [...byId.values()];
}

export function formatDate(ts, now = Date.now()) {
  const d = new Date(ts);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString([], opts);
}
